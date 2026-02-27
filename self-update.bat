@echo off
:: SmallClaw Self-Update & Restart Script
:: Called by the AI when user asks it to update itself.
:: 
:: Flow:
::   1. Stops current gateway (it called this, so it's about to exit anyway)
::   2. Runs `smallclaw update --yes` in the SmallClaw directory
::   3. Restarts the gateway
::   4. The gateway's Telegram channel will send the "done" message
::      (handled by the BOOT.md or the post-restart hook)
::
:: Usage (called by shell tool):
::   D:\SmallClaw\self-update.bat

title SmallClaw Self-Update

cd /d "D:\SmallClaw"

echo [self-update] Starting SmallClaw update...
echo [self-update] Timestamp: %date% %time%

:: Run the update with --yes to skip the interactive prompt
node dist\cli\index.js update --yes

if %ERRORLEVEL% NEQ 0 (
    echo [self-update] Update failed with error code %ERRORLEVEL%
    echo [self-update] Writing failure status...
    echo UPDATE_FAILED > "%USERPROFILE%\.smallclaw\last_self_update.txt"
    echo %date% %time% >> "%USERPROFILE%\.smallclaw\last_self_update.txt"
    exit /b 1
)

echo [self-update] Update complete. Writing success status...
echo UPDATE_SUCCESS > "%USERPROFILE%\.smallclaw\last_self_update.txt"
echo %date% %time% >> "%USERPROFILE%\.smallclaw\last_self_update.txt"

echo [self-update] Restarting SmallClaw gateway in 3 seconds...
timeout /t 3 /nobreak > nul

:: Start a new gateway window and exit this one
start "SmallClaw Gateway" cmd /k "cd /d D:\SmallClaw && node dist\cli\index.js gateway start --post-update"

exit /b 0
