@echo off
:: SmallClaw Auto-Start Script
:: This script is registered with Windows Task Scheduler to run at login.
:: It starts the SmallClaw gateway in a new terminal window.

title SmallClaw Gateway

:: Change to SmallClaw directory
cd /d "D:\SmallClaw"

:: Start the gateway
node dist/cli/index.js gateway start
