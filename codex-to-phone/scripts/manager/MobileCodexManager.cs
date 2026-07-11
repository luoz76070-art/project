using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

namespace MobileCodex
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var manager = new ManagerCore();
            if (args.Length > 0 && args[0] == "--start-minimized")
            {
                manager.LoadConfig();
                manager.StartRelay(true);
                return;
            }

            Application.Run(new ManagerForm(manager));
        }
    }

    internal sealed class ManagerCore
    {
        public readonly string AppDir;
        public readonly string RootDir;
        public readonly string EnvPath;
        public readonly string PidPath;
        public readonly string WatchdogPath;
        public event Action<string> Log;

        public ManagerCore()
        {
            AppDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            RootDir = ResolveRootDir(AppDir);
            EnvPath = Path.Combine(RootDir, ".env.local");
            PidPath = Path.Combine(RootDir, ".mobile-codex-relay.pid");
            WatchdogPath = Path.Combine(RootDir, "MobileCodexWatchdog.exe");
        }

        public Dictionary<string, string> LoadConfig()
        {
            var config = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            config["MOBILE_CODEX_HOST"] = "0.0.0.0";
            config["MOBILE_CODEX_PORT"] = "8787";
            config["MOBILE_CODEX_TOKEN"] = GenerateToken();
            config["CODEX_HOME"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
            config["MOBILE_CODEX_DEFAULT_CWD"] = RootDir;
            config["MOBILE_CODEX_DDNS_DOMAIN"] = "";

            if (!File.Exists(EnvPath)) return config;

            foreach (var raw in File.ReadAllLines(EnvPath, Encoding.UTF8))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#") || !line.Contains("=")) continue;
                var index = line.IndexOf('=');
                var key = line.Substring(0, index).Trim();
                var value = line.Substring(index + 1).Trim();
                if (key.Length > 0) config[key] = value;
            }
            if (string.IsNullOrWhiteSpace(config["CODEX_HOME"]) || !Directory.Exists(config["CODEX_HOME"]))
            {
                config["CODEX_HOME"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
            }
            if (string.IsNullOrWhiteSpace(config["MOBILE_CODEX_DEFAULT_CWD"]) || !Directory.Exists(config["MOBILE_CODEX_DEFAULT_CWD"]))
            {
                config["MOBILE_CODEX_DEFAULT_CWD"] = RootDir;
            }
            return config;
        }

        private static string GenerateToken()
        {
            using (var random = RandomNumberGenerator.Create())
            {
                var bytes = new byte[32];
                random.GetBytes(bytes);
                var builder = new StringBuilder("mobile-codex-");
                foreach (var value in bytes) builder.Append(value.ToString("x2"));
                return builder.ToString();
            }
        }

        public void SaveConfig(Dictionary<string, string> config)
        {
            var lines = new[]
            {
                "MOBILE_CODEX_HOST=" + Value(config, "MOBILE_CODEX_HOST"),
                "MOBILE_CODEX_PORT=" + Value(config, "MOBILE_CODEX_PORT"),
                "MOBILE_CODEX_TOKEN=" + Value(config, "MOBILE_CODEX_TOKEN"),
                "CODEX_HOME=" + Value(config, "CODEX_HOME"),
                "MOBILE_CODEX_DEFAULT_CWD=" + Value(config, "MOBILE_CODEX_DEFAULT_CWD"),
                "MOBILE_CODEX_DDNS_DOMAIN=" + Value(config, "MOBILE_CODEX_DDNS_DOMAIN")
            };
            File.WriteAllLines(EnvPath, lines, Encoding.UTF8);
            WriteLog("配置已保存：" + EnvPath);
        }

        public Process StartRelay(bool silent)
        {
            var config = LoadConfig();
            var relayExe = ResolveRelayExe();
            if (relayExe == null) throw new FileNotFoundException("找不到 MobileCodexRelay.exe，请重新构建 exe 包。");

            var port = Value(config, "MOBILE_CODEX_PORT");
            var existingPid = FindListeningPid(port);
            if (existingPid > 0)
            {
                throw new InvalidOperationException("端口 " + port + " 已被 pid=" + existingPid + " 占用。请先点停止，或换一个端口。");
            }

            var info = new ProcessStartInfo();
            info.FileName = relayExe;
            info.WorkingDirectory = RootDir;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = !silent;
            info.RedirectStandardError = !silent;
            info.EnvironmentVariables["MOBILE_CODEX_HOST"] = Value(config, "MOBILE_CODEX_HOST");
            info.EnvironmentVariables["MOBILE_CODEX_PORT"] = Value(config, "MOBILE_CODEX_PORT");
            info.EnvironmentVariables["MOBILE_CODEX_TOKEN"] = Value(config, "MOBILE_CODEX_TOKEN");
            info.EnvironmentVariables["CODEX_HOME"] = Value(config, "CODEX_HOME");
            info.EnvironmentVariables["MOBILE_CODEX_DEFAULT_CWD"] = Value(config, "MOBILE_CODEX_DEFAULT_CWD");

            var process = new Process();
            process.StartInfo = info;
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (!string.IsNullOrEmpty(e.Data) && !silent) WriteLog(e.Data);
            };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (!string.IsNullOrEmpty(e.Data) && !silent) WriteLog("ERR " + e.Data);
            };
            process.Start();
            if (!silent)
            {
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
            }
            File.WriteAllText(PidPath, process.Id.ToString(), Encoding.UTF8);
            if (!silent) WriteLog("Relay 已启动 pid=" + process.Id + "，运行文件：" + relayExe);
            return process;
        }

        public void StopRelay()
        {
            var stopped = false;
            if (File.Exists(PidPath))
            {
                int pid;
                if (int.TryParse(File.ReadAllText(PidPath).Trim(), out pid))
                {
                    stopped = TryStopPid(pid) || stopped;
                }
                File.Delete(PidPath);
            }

            foreach (var p in Process.GetProcessesByName("MobileCodexRelay"))
            {
                try
                {
                    if (p.MainModule != null && p.MainModule.FileName.StartsWith(AppDir, StringComparison.OrdinalIgnoreCase))
                    {
                        p.Kill();
                        stopped = true;
                    }
                }
                catch { }
            }
            WriteLog(stopped ? "Relay 已停止。" : "没有发现由本管理器启动的 Relay。");
        }

        public void StopAllClients()
        {
            var currentPid = Process.GetCurrentProcess().Id;
            var stopped = 0;

            foreach (var name in new[] { "MobileCodexWatchdog", "MobileCodexRelay", "MobileCodexManager" })
            {
                foreach (var process in Process.GetProcessesByName(name))
                {
                    if (process.Id == currentPid) continue;
                    if (TryStopProcess(process)) stopped++;
                }
            }

            CleanupPidFiles();
            WriteLog("已停止所有 Mobile Codex 客户端进程：" + stopped + " 个。当前管理器窗口已保留，可单独重新启动。");
        }

        public string TestEndpoint(string endpoint, string token)
        {
            var request = (HttpWebRequest)WebRequest.Create(endpoint.TrimEnd('/') + "/health");
            request.Method = "GET";
            request.Timeout = 8000;
            if (!string.IsNullOrEmpty(token)) request.Headers["Authorization"] = "Bearer " + token;
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var stream = response.GetResponseStream())
            using (var reader = new StreamReader(stream))
            {
                return reader.ReadToEnd();
            }
        }

        public void SetAutostart(bool enabled)
        {
            using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
            {
                if (enabled)
                {
                    var startupExe = File.Exists(WatchdogPath) ? WatchdogPath : Application.ExecutablePath;
                    var args = File.Exists(WatchdogPath) ? "" : " --start-minimized";
                    key.SetValue("MobileCodexManager", "\"" + startupExe + "\"" + args);
                    WriteLog(File.Exists(WatchdogPath) ? "已启用开机自启和后台守护。" : "已启用开机自启。");
                }
                else
                {
                    key.DeleteValue("MobileCodexManager", false);
                    WriteLog("已关闭开机自启。");
                }
            }
        }

        public string[] Ipv4Endpoints(string port)
        {
            return RunPowerShell("Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object InterfaceAlias, IPAddress | ForEach-Object { 'http://' + $_.IPAddress + ':' + " + EscapePs(port) + " + '  (' + $_.InterfaceAlias + ')' }");
        }

        public string[] Ipv6Endpoints(string port)
        {
            return RunPowerShell("Get-NetIPAddress -AddressFamily IPv6 | Where-Object { $_.IPAddress -ne '::1' -and $_.IPAddress -notlike 'fe80*' -and $_.AddressState -in @('Preferred','Deprecated') } | Sort-Object InterfaceAlias, IPAddress | ForEach-Object { 'http://[' + $_.IPAddress + ']:' + " + EscapePs(port) + " + '  (' + $_.InterfaceAlias + ')' }");
        }

        public string ResolveGuide(string name)
        {
            var candidates = new[]
            {
                Path.Combine(RootDir, "docs", "html", name + ".html"),
                Path.Combine(AppDir, "docs", "html", name + ".html")
            };
            foreach (var path in candidates)
            {
                if (File.Exists(path)) return path;
            }
            return null;
        }

        public void OpenGuide(string name)
        {
            var path = ResolveGuide(name);
            if (path == null) throw new FileNotFoundException("教程文件不存在：" + name);
            Process.Start(path);
        }

        public static string NewToken()
        {
            var bytes = new byte[32];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            var builder = new StringBuilder();
            foreach (var b in bytes) builder.Append(b.ToString("x2"));
            return builder.ToString();
        }

        public string LocalEndpoint(Dictionary<string, string> config)
        {
            var host = Value(config, "MOBILE_CODEX_HOST");
            var port = Value(config, "MOBILE_CODEX_PORT");
            return host == "::" ? "http://[::1]:" + port : "http://127.0.0.1:" + port;
        }

        public string ResolveRelayExe()
        {
            var candidates = new[]
            {
                Path.Combine(AppDir, "MobileCodexRelay.exe"),
                Path.Combine(RootDir, "MobileCodexRelay.exe"),
                Path.Combine(RootDir, "dist-exe", "MobileCodexRelay.exe")
            };
            foreach (var path in candidates)
            {
                if (File.Exists(path)) return path;
            }
            return null;
        }

        public static string Value(Dictionary<string, string> config, string key)
        {
            return config.ContainsKey(key) ? config[key] : "";
        }

        private static string ResolveRootDir(string appDir)
        {
            if (File.Exists(Path.Combine(appDir, "MobileCodexRelay.exe")) && File.Exists(Path.Combine(appDir, ".env.local")))
            {
                return appDir;
            }
            var parent = Directory.GetParent(appDir);
            if (parent != null && Directory.Exists(Path.Combine(parent.FullName, "apps")) && File.Exists(Path.Combine(parent.FullName, ".env.local")))
            {
                return parent.FullName;
            }
            return appDir;
        }

        private bool TryStopPid(int pid)
        {
            try
            {
                var p = Process.GetProcessById(pid);
                return TryStopProcess(p);
            }
            catch { return false; }
        }

        private bool TryStopProcess(Process process)
        {
            try
            {
                process.Kill();
                process.WaitForExit(3000);
                return true;
            }
            catch { return false; }
        }

        private void CleanupPidFiles()
        {
            foreach (var path in FindPidFiles())
            {
                try { File.Delete(path); }
                catch { }
            }
        }

        private IEnumerable<string> FindPidFiles()
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var dir in CandidatePidDirs())
            {
                var path = Path.Combine(dir, ".mobile-codex-relay.pid");
                if (seen.Add(path) && File.Exists(path)) yield return path;
            }
        }

        private IEnumerable<string> CandidatePidDirs()
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var dir in new[] { AppDir, RootDir })
            {
                if (!string.IsNullOrWhiteSpace(dir) && Directory.Exists(dir) && seen.Add(dir)) yield return dir;
            }

            var parent = Directory.GetParent(AppDir);
            if (parent == null || !Directory.Exists(parent.FullName)) yield break;
            foreach (var dir in Directory.GetDirectories(parent.FullName, "安装文件*"))
            {
                if (seen.Add(dir)) yield return dir;
            }
        }

        private static int FindListeningPid(string port)
        {
            var output = RunPowerShellStatic("Get-NetTCPConnection -LocalPort " + EscapePs(port) + " -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess");
            if (output.Length == 0) return 0;
            int pid;
            return int.TryParse(output[0].Trim(), out pid) ? pid : 0;
        }

        private string[] RunPowerShell(string command)
        {
            return RunPowerShellStatic(command);
        }

        private static string[] RunPowerShellStatic(string command)
        {
            var info = new ProcessStartInfo();
            info.FileName = "powershell.exe";
            info.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command \"" + command.Replace("\"", "\\\"") + "\"";
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            using (var process = Process.Start(info))
            {
                var output = process.StandardOutput.ReadToEnd();
                process.WaitForExit(8000);
                return output.Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries);
            }
        }

        private static string EscapePs(string value)
        {
            return "'" + value.Replace("'", "''") + "'";
        }

        private void WriteLog(string text)
        {
            var handler = Log;
            if (handler != null) handler(text);
        }
    }

    internal sealed class ManagerForm : Form
    {
        private readonly ManagerCore _manager;
        private TextBox _host;
        private TextBox _port;
        private TextBox _token;
        private TextBox _ddns;
        private TextBox _codexHome;
        private TextBox _cwd;
        private TextBox _log;

        public ManagerForm(ManagerCore manager)
        {
            _manager = manager;
            _manager.Log += AppendLog;
            BuildUi();
            LoadConfigToUi();
            AppendLog("管理器已打开。项目根目录：" + _manager.RootDir);
            AppendLog("Relay exe：" + (_manager.ResolveRelayExe() ?? "未找到"));
        }

        private void BuildUi()
        {
            Text = "Mobile Codex Manager";
            Size = new Size(820, 690);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 9);

            Label("监听 Host", 18, 22);
            _host = Box(140, 20, 200);
            Button("IPv4", 355, 18, 75, delegate { _host.Text = "0.0.0.0"; AppendLog("已切换 IPv4 局域网模式。"); });
            Button("IPv6", 438, 18, 75, delegate { _host.Text = "::"; AppendLog("已切换 IPv6/DDNSGo 模式。"); });
            Button("IPv4 教程", 525, 18, 95, delegate { SafeGuide("ipv4-lan"); });
            Button("IPv6 教程", 630, 18, 95, delegate { SafeGuide("ipv6-ddnsgo"); });

            Label("端口", 18, 58);
            _port = Box(140, 56, 200);
            Button("测试本机", 355, 54, 95, delegate { SafeTestLocal(); });
            Button("测试域名", 458, 54, 95, delegate { SafeTestDdns(); });
            Button("排错教程", 563, 54, 95, delegate { SafeGuide("troubleshooting"); });

            Label("Token/密码", 18, 94);
            _token = Box(140, 92, 413);
            _token.UseSystemPasswordChar = true;
            Button("显示", 563, 90, 60, delegate { _token.UseSystemPasswordChar = !_token.UseSystemPasswordChar; });
            Button("生成", 630, 90, 60, delegate { _token.Text = ManagerCore.NewToken(); AppendLog("已生成随机 Token。"); });
            Button("教程", 697, 90, 60, delegate { SafeGuide("token-security"); });

            Label("DDNS 域名", 18, 130);
            _ddns = Box(140, 128, 413);

            Label("CODEX_HOME", 18, 166);
            _codexHome = Box(140, 164, 615);

            Label("默认工作目录", 18, 202);
            _cwd = Box(140, 200, 615);

            Button("保存配置", 18, 242, 105, delegate { SafeSave(); });
            Button("启动", 133, 242, 80, delegate { SafeStart(false); });
            Button("重启", 223, 242, 80, delegate { SafeRestart(); });
            Button("停止", 313, 242, 80, delegate { SafeStop(); });
            Button("启用自启", 403, 242, 95, delegate { SafeAutostart(true); });
            Button("关闭自启", 508, 242, 95, delegate { SafeAutostart(false); });
            Button("停止所有客户端", 613, 242, 130, delegate { SafeStopAllClients(); });

            var hint = new Label();
            hint.Text = "手机端填入下方日志显示的 IPv4/IPv6/DDNS 地址，并使用这里的 Token。";
            hint.Location = new Point(18, 286);
            hint.Size = new Size(760, 24);
            Controls.Add(hint);

            _log = new TextBox();
            _log.Multiline = true;
            _log.ReadOnly = true;
            _log.ScrollBars = ScrollBars.Vertical;
            _log.Location = new Point(18, 318);
            _log.Size = new Size(760, 300);
            Controls.Add(_log);
        }

        private void LoadConfigToUi()
        {
            var config = _manager.LoadConfig();
            _host.Text = ManagerCore.Value(config, "MOBILE_CODEX_HOST");
            _port.Text = ManagerCore.Value(config, "MOBILE_CODEX_PORT");
            _token.Text = ManagerCore.Value(config, "MOBILE_CODEX_TOKEN");
            _ddns.Text = ManagerCore.Value(config, "MOBILE_CODEX_DDNS_DOMAIN");
            _codexHome.Text = ManagerCore.Value(config, "CODEX_HOME");
            _cwd.Text = ManagerCore.Value(config, "MOBILE_CODEX_DEFAULT_CWD");
        }

        private Dictionary<string, string> UiConfig()
        {
            var config = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            config["MOBILE_CODEX_HOST"] = _host.Text.Trim();
            config["MOBILE_CODEX_PORT"] = _port.Text.Trim();
            config["MOBILE_CODEX_TOKEN"] = _token.Text.Trim();
            config["MOBILE_CODEX_DDNS_DOMAIN"] = _ddns.Text.Trim();
            config["CODEX_HOME"] = _codexHome.Text.Trim();
            config["MOBILE_CODEX_DEFAULT_CWD"] = _cwd.Text.Trim();
            return config;
        }

        private void SafeSave()
        {
            try { _manager.SaveConfig(UiConfig()); }
            catch (Exception ex) { AppendLog("保存失败：" + ex.Message); }
        }

        private void SafeStart(bool silent)
        {
            try
            {
                SafeSave();
                _manager.StartRelay(silent);
                foreach (var endpoint in _manager.Ipv4Endpoints(_port.Text.Trim())) AppendLog("IPv4: " + endpoint);
                foreach (var endpoint in _manager.Ipv6Endpoints(_port.Text.Trim())) AppendLog("IPv6: " + endpoint);
                if (_ddns.Text.Trim().Length > 0) AppendLog("DDNS: http://" + _ddns.Text.Trim() + ":" + _port.Text.Trim());
            }
            catch (Exception ex) { AppendLog("启动失败：" + ex.Message); }
        }

        private void SafeRestart()
        {
            SafeStop();
            SafeStart(false);
        }

        private void SafeStop()
        {
            try { _manager.StopRelay(); }
            catch (Exception ex) { AppendLog("停止失败：" + ex.Message); }
        }

        private void SafeStopAllClients()
        {
            try { _manager.StopAllClients(); }
            catch (Exception ex) { AppendLog("停止所有客户端失败：" + ex.Message); }
        }

        private void SafeTestLocal()
        {
            try
            {
                SafeSave();
                var config = UiConfig();
                var endpoint = _manager.LocalEndpoint(config);
                var result = _manager.TestEndpoint(endpoint, _token.Text.Trim());
                AppendLog("本机测试 OK：" + endpoint + " " + Truncate(result));
            }
            catch (Exception ex) { AppendLog("本机测试失败：" + ex.Message); }
        }

        private void SafeTestDdns()
        {
            try
            {
                SafeSave();
                var endpoint = "http://" + _ddns.Text.Trim() + ":" + _port.Text.Trim();
                var result = _manager.TestEndpoint(endpoint, _token.Text.Trim());
                AppendLog("域名测试 OK：" + endpoint + " " + Truncate(result));
            }
            catch (Exception ex) { AppendLog("域名测试失败：" + ex.Message); }
        }

        private void SafeAutostart(bool enabled)
        {
            try { _manager.SetAutostart(enabled); }
            catch (Exception ex) { AppendLog("自启设置失败：" + ex.Message); }
        }

        private void SafeGuide(string name)
        {
            try { _manager.OpenGuide(name); }
            catch (Exception ex) { AppendLog("打开教程失败：" + ex.Message); }
        }

        private void Label(string text, int x, int y)
        {
            var label = new Label();
            label.Text = text;
            label.Location = new Point(x, y);
            label.Size = new Size(115, 24);
            Controls.Add(label);
        }

        private TextBox Box(int x, int y, int width)
        {
            var box = new TextBox();
            box.Location = new Point(x, y);
            box.Size = new Size(width, 24);
            Controls.Add(box);
            return box;
        }

        private void Button(string text, int x, int y, int width, EventHandler handler)
        {
            var button = new Button();
            button.Text = text;
            button.Location = new Point(x, y);
            button.Size = new Size(width, 28);
            button.Click += handler;
            Controls.Add(button);
        }

        private void AppendLog(string text)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(AppendLog), text);
                return;
            }
            _log.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + text + "\r\n");
        }

        private static string Truncate(string text)
        {
            if (text == null) return "";
            return text.Length > 180 ? text.Substring(0, 180) + "..." : text;
        }
    }
}
