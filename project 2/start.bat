@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:3000
  node server.js
) else (
  echo Node.js not found - using the engine built into VS Code
  set ELECTRON_RUN_AS_NODE=1
  start "" http://localhost:3000
  "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" server.js
)
pause
