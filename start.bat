@echo off
title WhatsApp Sales Assistant
cd /d "E:\OpenCode File\WhatsApp"

echo ============================================
echo   WhatsApp Sales Assistant
echo   AI-Powered Translation ^& Reply Copilot
echo ============================================
echo.

:: Kill any existing process on port 3000
echo [*] Checking port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000.*LISTENING" 2^>nul') do (
    echo [*] Killing existing process PID %%a...
    taskkill /f /pid %%a >nul 2>&1
    timeout /t 2 /nobreak >nul
)
echo [*] Port 3000 is free.
echo.

:: Start the server
echo [*] Starting server...
echo.
start "" http://localhost:3000
npm start
pause
