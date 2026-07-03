# DEPRECATED: Use install-daemon.ps1 or setup.ps1 instead.
# This script now registers the scheduler daemon (AtLogon), not a daily one-shot task.

Write-Host "NOTE: install-task.ps1 is deprecated. Use install-daemon.ps1 or setup.ps1." -ForegroundColor Yellow
Write-Host ""

& "$PSScriptRoot\install-daemon.ps1" @args
