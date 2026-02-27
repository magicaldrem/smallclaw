@echo off
:: test-webhooks.bat
:: Quick smoke test for the SmallClaw webhook endpoints
:: Usage: test-webhooks.bat YOUR_TOKEN_HERE

set TOKEN=%1
if "%TOKEN%"=="" (
    echo Usage: test-webhooks.bat YOUR_TOKEN_HERE
    echo Example: test-webhooks.bat mysecrettoken123
    pause
    exit /b 1
)

set BASE=http://localhost:18789/hooks

echo.
echo ============================================
echo  SmallClaw Webhook Smoke Tests
echo ============================================
echo Token: %TOKEN%
echo Base:  %BASE%
echo.

echo [1] Testing /hooks/status (GET)...
curl -s -X GET "%BASE%/status" ^
  -H "x-smallclaw-token: %TOKEN%" ^
  -H "Content-Type: application/json"
echo.
echo.

echo [2] Testing /hooks/wake (lightweight nudge)...
curl -s -X POST "%BASE%/wake" ^
  -H "x-smallclaw-token: %TOKEN%" ^
  -H "Content-Type: application/json" ^
  -d "{\"text\": \"Test wake event from smoke test\", \"mode\": \"now\"}"
echo.
echo.

echo [3] Testing /hooks/agent (full agent run, no delivery)...
curl -s -X POST "%BASE%/agent" ^
  -H "x-smallclaw-token: %TOKEN%" ^
  -H "Content-Type: application/json" ^
  -d "{\"message\": \"Say hello and confirm webhooks are working. Keep it under 20 words.\", \"name\": \"SmokeTest\", \"deliver\": false}"
echo.
echo.

echo [4] Testing auth rejection (wrong token)...
curl -s -X GET "%BASE%/status" ^
  -H "x-smallclaw-token: wrongtoken" ^
  -H "Content-Type: application/json"
echo.
echo.

echo [5] Testing query-string token rejection (should return 400)...
curl -s -X GET "%BASE%/status?token=%TOKEN%"
echo.
echo.

echo ============================================
echo  Done! Check gateway terminal for agent logs
echo ============================================
pause
