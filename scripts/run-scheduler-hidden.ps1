# 无窗口后台启动 scheduler（供任务计划程序调用）
$ErrorActionPreference = "Stop"

$ProjectPath = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectPath

$nodePath = (Get-Command node -ErrorAction Stop).Source
$entryPoint = Join-Path $ProjectPath "dist\scheduler.js"

if (-not (Test-Path $entryPoint)) {
    throw "Scheduler not built: $entryPoint — run npm run build first."
}

# 阻塞运行 node，任务计划状态保持 Running；PowerShell 以 Hidden 启动故无可见窗口
& $nodePath $entryPoint
