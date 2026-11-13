on writeLog(messageText)
  set nowText to do shell script "/bin/date -u +%Y-%m-%dT%H:%M:%SZ"
  do shell script "/bin/echo " & quoted form of (nowText & " " & messageText) & " >> /tmp/codex-live-session-helper.log"
end writeLog

on run
  writeLog("start")
  try
    set inputPath to "/tmp/codex-live-session-input.txt"
    set messageText to do shell script "/bin/cat " & quoted form of inputPath
    if messageText starts with "__CODEX_LIVE_SESSION_PERMISSION_PROBE__" then
      writeLog("probe-start")
      tell application "TextEdit"
        activate
        make new document
      end tell
      delay 0.35
      tell application "System Events"
        keystroke "codex live session permission probe"
      end tell
      delay 0.15
      tell application "TextEdit"
        close front document saving no
      end tell
      writeLog("probe-ok")
      quit
    end if

    set previousClipboard to the clipboard
    try
      set the clipboard to messageText
      tell application "Codex" to activate
      delay 0.45
      tell application "System Events"
        keystroke "v" using command down
        delay 0.08
        key code 36
      end tell
      delay 0.1
      set the clipboard to previousClipboard
      writeLog("inject-ok")
      quit
    on error errMsg number errNum
      try
        set the clipboard to previousClipboard
      end try
      writeLog("inject-error " & errNum & " " & errMsg)
      quit
    end try
  on error errMsg number errNum
    writeLog("error " & errNum & " " & errMsg)
    quit
  end try
end run
