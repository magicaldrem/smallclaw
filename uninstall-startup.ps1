# SmallClaw Startup Uninstaller
# Removes the auto-start task registered by install-startup.ps1

$taskName = "SmallClaw Gateway"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "[OK] SmallClaw auto-start removed." -ForegroundColor Green
} else {
    Write-Host "[info] No task named '$taskName' was found." -ForegroundColor Yellow
}
pause
