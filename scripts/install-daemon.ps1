param(
    [string]$TaskName = "AutoDayReport-Scheduler",
    [string]$ProjectPath = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ProjectPath)) {
    throw "Project path not found: $ProjectPath"
}

$entryPoint = Join-Path $ProjectPath "dist\scheduler.js"

if (-not (Test-Path $entryPoint)) {
    Write-Host "Building project..."
    Push-Location $ProjectPath
    try {
        npm run build
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $entryPoint)) {
    throw "Build failed: $entryPoint not found"
}

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    throw "Node.js not found in PATH. Please install Node.js first."
}

$configPath = Join-Path $ProjectPath "config\config.json"
$runTimeHint = "18:00"
if (Test-Path $configPath) {
    try {
        $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($cfg.schedule.runTime) {
            $runTimeHint = $cfg.schedule.runTime
        }
    } catch {
        Write-Host "Warning: could not read schedule.runTime from config.json"
    }
}

$action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$entryPoint`"" -WorkingDirectory $ProjectPath
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing task: $TaskName"
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "AutoDayReport scheduler daemon (runs at logon, executes daily per config schedule.runTime)"

Write-Host "Scheduled task '$TaskName' created successfully."
Write-Host "  Trigger: At user logon"
Write-Host "  Command: node `"$entryPoint`""
Write-Host "  Daily run time: $runTimeHint (from config/config.json schedule.runTime)"
Write-Host ""
Write-Host "To change run time: edit config/config.json, then restart the scheduler task."
Write-Host "To run now:  schtasks /Run /TN `"$TaskName`""
Write-Host "To stop:     schtasks /End /TN `"$TaskName`""
