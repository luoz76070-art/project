using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace MobileCodex
{
    internal static class Program
    {
        private static void Main()
        {
            var root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            var envPath = Path.Combine(root, ".env.local");
            var logPath = Path.Combine(root, "watchdog.log");
            var pidPath = Path.Combine(root, ".mobile-codex-relay.pid");

            for (;;)
            {
                try
                {
                    var config = EnvFile.Load(envPath);
                    var host = config.Value("MOBILE_CODEX_HOST", "0.0.0.0");
                    var port = config.Value("MOBILE_CODEX_PORT", "8787");
                    var token = config.Value("MOBILE_CODEX_TOKEN", "");
                    if (!HealthOk(host, port, token))
                    {
                        StartRelay(root, config, pidPath, logPath);
                    }
                }
                catch (Exception ex)
                {
                    AppendLog(logPath, "watchdog error: " + ex.Message);
                }
                Thread.Sleep(TimeSpan.FromSeconds(30));
            }
        }

        private static bool HealthOk(string host, string port, string token)
        {
            foreach (var url in HealthUrls(host, port))
            {
                if (HealthOk(url, token)) return true;
            }
            return false;
        }

        private static string[] HealthUrls(string host, string port)
        {
            host = (host ?? "").Trim();
            if (host == "::")
            {
                return new[] { "http://[::1]:" + port + "/health", "http://127.0.0.1:" + port + "/health" };
            }
            if (host.Length == 0 || host == "0.0.0.0")
            {
                return new[] { "http://127.0.0.1:" + port + "/health", "http://[::1]:" + port + "/health" };
            }
            if (host.IndexOf(':') >= 0 && !host.StartsWith("["))
            {
                return new[] { "http://[" + host + "]:" + port + "/health", "http://127.0.0.1:" + port + "/health" };
            }
            return new[] { "http://" + host + ":" + port + "/health", "http://127.0.0.1:" + port + "/health" };
        }

        private static bool HealthOk(string url, string token)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Timeout = 5000;
                if (!string.IsNullOrEmpty(token)) request.Headers["Authorization"] = "Bearer " + token;
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    return (int)response.StatusCode >= 200 && (int)response.StatusCode < 300;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void StartRelay(string root, EnvFile config, string pidPath, string logPath)
        {
            var relayExe = Path.Combine(root, "MobileCodexRelay.exe");
            if (!File.Exists(relayExe))
            {
                AppendLog(logPath, "relay exe missing: " + relayExe);
                return;
            }

            var info = new ProcessStartInfo();
            info.FileName = relayExe;
            info.WorkingDirectory = root;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.EnvironmentVariables["MOBILE_CODEX_HOST"] = config.Value("MOBILE_CODEX_HOST", "0.0.0.0");
            info.EnvironmentVariables["MOBILE_CODEX_PORT"] = config.Value("MOBILE_CODEX_PORT", "8787");
            info.EnvironmentVariables["MOBILE_CODEX_TOKEN"] = config.Value("MOBILE_CODEX_TOKEN", "change-me");
            info.EnvironmentVariables["CODEX_HOME"] = config.Value("CODEX_HOME", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex"));
            info.EnvironmentVariables["MOBILE_CODEX_DEFAULT_CWD"] = config.Value("MOBILE_CODEX_DEFAULT_CWD", root);

            var process = new Process();
            process.StartInfo = info;
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (!string.IsNullOrEmpty(e.Data)) AppendLog(logPath, e.Data);
            };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (!string.IsNullOrEmpty(e.Data)) AppendLog(logPath, "ERR " + e.Data);
            };
            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            File.WriteAllText(pidPath, process.Id.ToString(), Encoding.UTF8);
            AppendLog(logPath, "relay started pid=" + process.Id);
        }

        private static void AppendLog(string path, string text)
        {
            try
            {
                var line = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + text + Environment.NewLine;
                File.AppendAllText(path, line, Encoding.UTF8);
            }
            catch
            {
            }
        }
    }

    internal sealed class EnvFile
    {
        private readonly System.Collections.Generic.Dictionary<string, string> _values =
            new System.Collections.Generic.Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public static EnvFile Load(string path)
        {
            var env = new EnvFile();
            if (!File.Exists(path)) return env;
            foreach (var raw in File.ReadAllLines(path, Encoding.UTF8))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#") || !line.Contains("=")) continue;
                var index = line.IndexOf('=');
                env._values[line.Substring(0, index).Trim()] = line.Substring(index + 1).Trim();
            }
            return env;
        }

        public string Value(string key, string fallback)
        {
            string value;
            return _values.TryGetValue(key, out value) && !string.IsNullOrWhiteSpace(value) ? value : fallback;
        }
    }
}
