' 无窗口后台启动 scheduler（供 Windows 任务计划程序调用）
' wscript.exe //B //Nologo 运行本脚本，不会出现在任务栏

Option Explicit

Dim fso, shell, scriptDir, projectPath, nodePath, schedulerJs

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("Wscript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectPath = fso.GetParentFolderName(scriptDir)
schedulerJs = projectPath & "\dist\scheduler.js"

nodePath = FindNodeExe(shell, fso)
If nodePath = "" Then
  WScript.Echo "Node.js not found. Install Node.js 18+ and re-run install-daemon.ps1"
  WScript.Quit 1
End If

If Not fso.FileExists(schedulerJs) Then
  WScript.Echo "Scheduler not built: " & schedulerJs & " — run npm run build first."
  WScript.Quit 1
End If

shell.CurrentDirectory = projectPath
' 0 = 完全隐藏窗口；True = 等待 node 退出（任务计划保持 Running 状态）
shell.Run """" & nodePath & """ """ & schedulerJs & """", 0, True

Function FindNodeExe(shell, fso)
  Dim candidates, c, exec, line

  candidates = Array( _
    shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe"), _
    shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\node.exe"), _
    shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\node\node.exe"), _
    shell.ExpandEnvironmentStrings("%APPDATA%\nvm\current\node.exe") _
  )

  For Each c In candidates
    If fso.FileExists(c) Then
      FindNodeExe = c
      Exit Function
    End If
  Next

  Set exec = shell.Exec("cmd /c where node 2>nul")
  Do While exec.Status = 0
    WScript.Sleep 50
  Loop
  line = Trim(exec.StdOut.ReadLine())
  If line <> "" And fso.FileExists(line) Then
    FindNodeExe = line
  Else
    FindNodeExe = ""
  End If
End Function
