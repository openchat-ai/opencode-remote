@echo off
cd /d "%~dp0"
set PKG_PATH=%APPDATA%\npm\node_modules\opencode-remote-control
pm2 delete remote-control 2>nul
pm2 start "%PKG_PATH%\dist\index.js" --name remote-control --cwd "%~dp0"
pm2 save