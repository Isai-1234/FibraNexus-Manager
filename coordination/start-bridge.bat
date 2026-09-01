@echo off
cd /d "%~dp0.."
echo Bridge Claude-Cursor — poll 5s
node coordination\bridge.mjs
pause
