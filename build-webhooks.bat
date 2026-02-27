@echo off
echo Building SmallClaw with webhook support...
cd /d D:\SmallClaw
call npm run build
if %ERRORLEVEL% neq 0 (
    echo BUILD FAILED
    pause
    exit /b 1
)
echo.
echo Build successful! Webhook endpoints are ready.
echo.
echo To enable webhooks, add this to your config.json:
echo {
echo   "hooks": {
echo     "enabled": true,
echo     "token": "your-secret-here",
echo     "path": "/hooks"
echo   }
echo }
echo.
echo Then restart the gateway. Endpoints will be:
echo   POST http://localhost:18789/hooks/wake
echo   POST http://localhost:18789/hooks/agent
echo   GET  http://localhost:18789/hooks/status
echo.
pause
