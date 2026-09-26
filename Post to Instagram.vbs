Option Explicit
Dim shell, files, folder, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
command = """" & shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\PowerShell\7\pwsh.exe"" -NoProfile -NonInteractive -File """ & folder & "\launch.ps1"" post"
shell.Run command, 0, False
