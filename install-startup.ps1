# SmallClaw Startup Installer
# Run this once (as your normal user, no admin needed) to register SmallClaw
# to auto-launch when you log in to Windows.
#
# Usage:
#   Right-click this file → "Run with PowerShell"
#   OR in a PowerShell terminal: .\install-startup.ps1

$taskName   = "SmallClaw Gateway"
$scriptPath = "D:\SmallClaw\start-smallclaw.bat"

# Check the bat file exists
if (-not (Test-Path $scriptPath)) {
    Write-Host "[ERROR] Could not find: $scriptPath" -ForegroundColor Red
    Write-Host "Make sure SmallClaw is in D:\SmallClaw" -ForegroundColor Red
    pause
    exit 1
}

# Remove existing task if it exists (clean reinstall)
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "[info] Removed existing task." -ForegroundColor Yellow
}

# Build the task:
#   - Trigger: At log on of current user
#   - Action: Run the .bat file in a visible terminal window
#   - Delay: 10 seconds after login (gives Windows time to settle, Ollama to start)
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser

$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/k `"$scriptPath`"" `
    -WorkingDirectory "D:\SmallClaw"

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

# Register the task (no admin required for AtLogOn of current user)
Register-ScheduledTask `
    -TaskName $taskName `
    -Trigger $trigger `
    -Action $action `
    -Settings $settings `
    -RunLevel Limited `
    -Force | Out-Null

# Add the 10s delay via XML patch (New-ScheduledTaskTrigger doesn't expose delay)
$task = Get-ScheduledTask -TaskName $taskName
$xml  = [xml]($task | Export-ScheduledTask)
$ns   = "http://schemas.microsoft.com/windows/2004/02/mit/task"
$triggerNode = $xml.Task.Triggers.LogonTrigger
if ($triggerNode) {
    $delayNode = $xml.CreateElement("Delay", $ns)
    $delayNode.InnerText = "PT10S"
    $triggerNode.AppendChild($delayNode) | Out-Null
    $xml.Save("$env:TEMP\smallclaw-task.xml")
    Register-ScheduledTask -TaskName $taskName -Xml (Get-Content "$env:TEMP\smallclaw-task.xml" -Raw) -Force | Out-Null
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "  SmallClaw startup task registered!" -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Task name : $taskName"
Write-Host "  Trigger   : At login for $currentUser"
Write-Host "  Delay     : 10 seconds (lets Ollama start first)"
Write-Host "  Action    : Opens terminal running SmallClaw gateway"
Write-Host ""
Write-Host "To remove auto-start later, run:" -ForegroundColor Cyan
Write-Host "  .\uninstall-startup.ps1  (or use Task Scheduler GUI)" -ForegroundColor Cyan
Write-Host ""
pause
