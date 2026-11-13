$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Import-Module (Join-Path $PSScriptRoot "MobileCodexManager.psm1") -Force

$config = Read-MobileCodexConfig

function Add-Label($form, [string]$text, [int]$x, [int]$y, [int]$w = 120) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $text
  $label.Location = New-Object System.Drawing.Point($x, $y)
  $label.Size = New-Object System.Drawing.Size($w, 24)
  $form.Controls.Add($label)
  return $label
}

function Add-TextBox($form, [string]$text, [int]$x, [int]$y, [int]$w = 420) {
  $box = New-Object System.Windows.Forms.TextBox
  $box.Text = $text
  $box.Location = New-Object System.Drawing.Point($x, $y)
  $box.Size = New-Object System.Drawing.Size($w, 24)
  $form.Controls.Add($box)
  return $box
}

function Add-Button($form, [string]$text, [int]$x, [int]$y, [int]$w = 110) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $text
  $button.Location = New-Object System.Drawing.Point($x, $y)
  $button.Size = New-Object System.Drawing.Size($w, 28)
  $form.Controls.Add($button)
  return $button
}

function Append-Log([string]$text) {
  $log.AppendText("[$(Get-Date -Format 'HH:mm:ss')] $text`r`n")
}

function Current-Endpoint {
  if ($hostBox.Text -eq "::") { return "http://[::1]:$($portBox.Text)" }
  return "http://127.0.0.1:$($portBox.Text)"
}

function Save-FormConfig {
  Save-MobileCodexConfig `
    -HostValue $hostBox.Text `
    -Port $portBox.Text `
    -Token $tokenBox.Text `
    -CodexHome $codexHomeBox.Text `
    -DefaultCwd $cwdBox.Text `
    -DdnsDomain $ddnsBox.Text | Out-Null
  Append-Log "配置已保存到 .env.local"
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Mobile Codex Manager"
$form.Size = New-Object System.Drawing.Size(760, 650)
$form.StartPosition = "CenterScreen"
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)

Add-Label $form "监听 Host" 18 22
$hostBox = Add-TextBox $form $config.MOBILE_CODEX_HOST 140 20 180
$ipv4Button = Add-Button $form "IPv4 模式" 335 18 95
$ipv6Button = Add-Button $form "IPv6 模式" 440 18 95
$ipv4GuideButton = Add-Button $form "IPv4 教程" 548 18 90
$ipv6GuideButton = Add-Button $form "IPv6 教程" 645 18 90

Add-Label $form "端口" 18 58
$portBox = Add-TextBox $form $config.MOBILE_CODEX_PORT 140 56 180
$testLocalButton = Add-Button $form "测试本机" 335 54 95
$testDdnsButton = Add-Button $form "测试域名" 440 54 95
$troubleButton = Add-Button $form "排错教程" 548 54 90

Add-Label $form "Token/密码" 18 94
$tokenBox = Add-TextBox $form $config.MOBILE_CODEX_TOKEN 140 92 395
$tokenBox.UseSystemPasswordChar = $true
$showTokenButton = Add-Button $form "显示" 548 90 60
$genTokenButton = Add-Button $form "生成" 615 90 60
$tokenGuideButton = Add-Button $form "教程" 682 90 54

Add-Label $form "DDNS 域名" 18 130
$ddnsBox = Add-TextBox $form $config.MOBILE_CODEX_DDNS_DOMAIN 140 128 395

Add-Label $form "CODEX_HOME" 18 166
$codexHomeBox = Add-TextBox $form $config.CODEX_HOME 140 164 595

Add-Label $form "默认工作目录" 18 202
$cwdBox = Add-TextBox $form $config.MOBILE_CODEX_DEFAULT_CWD 140 200 595

$saveButton = Add-Button $form "保存配置" 18 242 105
$startButton = Add-Button $form "启动 Relay" 135 242 105
$restartButton = Add-Button $form "重启 Relay" 252 242 105
$stopButton = Add-Button $form "停止 Relay" 369 242 105
$autostartButton = Add-Button $form "启用自启" 486 242 105
$disableAutostartButton = Add-Button $form "关闭自启" 603 242 105

$endpointLabel = New-Object System.Windows.Forms.Label
$endpointLabel.Text = "手机 Endpoint：保存并启动后，下方日志会显示候选地址"
$endpointLabel.Location = New-Object System.Drawing.Point(18, 285)
$endpointLabel.Size = New-Object System.Drawing.Size(720, 24)
$form.Controls.Add($endpointLabel)

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ScrollBars = "Vertical"
$log.ReadOnly = $true
$log.Location = New-Object System.Drawing.Point(18, 318)
$log.Size = New-Object System.Drawing.Size(717, 280)
$form.Controls.Add($log)

$ipv4Button.Add_Click({ $hostBox.Text = "0.0.0.0"; Append-Log "已切换 IPv4 局域网模式" })
$ipv6Button.Add_Click({ $hostBox.Text = "::"; Append-Log "已切换 IPv6/DDNSGo 模式" })
$showTokenButton.Add_Click({
  $tokenBox.UseSystemPasswordChar = -not $tokenBox.UseSystemPasswordChar
  $showTokenButton.Text = if ($tokenBox.UseSystemPasswordChar) { "显示" } else { "隐藏" }
})
$genTokenButton.Add_Click({ $tokenBox.Text = New-MobileCodexToken; Append-Log "已生成强随机 Token，请保存配置并同步到手机 APK" })
$saveButton.Add_Click({ try { Save-FormConfig } catch { Append-Log "保存失败：$($_.Exception.Message)" } })
$startButton.Add_Click({
  try {
    Save-FormConfig
    $p = Start-MobileCodexRelay
    Append-Log "Relay 已启动 pid=$($p.Id)"
    Get-MobileCodexIpv4Endpoints | ForEach-Object { Append-Log "IPv4: $_" }
    Get-MobileCodexIpv6Endpoints | ForEach-Object { Append-Log "IPv6: $_" }
    if ($ddnsBox.Text) { Append-Log "DDNS: http://$($ddnsBox.Text):$($portBox.Text)" }
  } catch { Append-Log "启动失败：$($_.Exception.Message)" }
})
$restartButton.Add_Click({
  try {
    Save-FormConfig
    $p = Start-MobileCodexRelay -Restart
    Append-Log "Relay 已重启 pid=$($p.Id)"
  } catch { Append-Log "重启失败：$($_.Exception.Message)" }
})
$stopButton.Add_Click({
  try { $ids = Stop-MobileCodexRelay; Append-Log "已停止 Relay：$($ids -join ', ')" } catch { Append-Log "停止失败：$($_.Exception.Message)" }
})
$testLocalButton.Add_Click({
  try {
    Save-FormConfig
    $result = Test-MobileCodexLocal
    Append-Log "本机测试 OK：$($result.mode)"
  } catch { Append-Log "本机测试失败：$($_.Exception.Message)" }
})
$testDdnsButton.Add_Click({
  try {
    Save-FormConfig
    $result = Test-MobileCodexDdns
    Append-Log "域名测试 OK：$($result.mode)"
  } catch { Append-Log "域名测试失败：$($_.Exception.Message)" }
})
$autostartButton.Add_Click({ try { $path = Set-MobileCodexAutostart -Enabled $true; Append-Log "已启用自启：$path" } catch { Append-Log "自启失败：$($_.Exception.Message)" } })
$disableAutostartButton.Add_Click({ try { $path = Set-MobileCodexAutostart -Enabled $false; Append-Log "已关闭自启：$path" } catch { Append-Log "关闭自启失败：$($_.Exception.Message)" } })
$ipv4GuideButton.Add_Click({ Open-MobileCodexGuide "ipv4-lan" })
$ipv6GuideButton.Add_Click({ Open-MobileCodexGuide "ipv6-ddnsgo" })
$tokenGuideButton.Add_Click({ Open-MobileCodexGuide "token-security" })
$troubleButton.Add_Click({ Open-MobileCodexGuide "troubleshooting" })

Append-Log "管理器已打开。先配置 Host/端口/Token，再保存并启动。"
[void]$form.ShowDialog()
