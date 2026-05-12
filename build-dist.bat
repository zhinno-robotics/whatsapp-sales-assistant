@echo off
title Build Distribution Package
cd /d "%~dp0"

echo ============================================
echo   Building Portable Distribution Package
echo ============================================
echo.

:: Ensure dependencies are installed
if not exist node_modules\ (
    echo [*] Installing dependencies...
    call npm install
)

:: Create dist folder
if exist dist rmdir /s /q dist
mkdir dist\whatsapp-sales-assistant

echo [*] Copying files...

:: Source code
xcopy /e /i /q src dist\whatsapp-sales-assistant\src >nul

:: Config files
copy package.json dist\whatsapp-sales-assistant\ >nul
copy package-lock.json dist\whatsapp-sales-assistant\ >nul
copy .env.example dist\whatsapp-sales-assistant\ >nul

:: Launcher scripts
copy start.bat dist\whatsapp-sales-assistant\ >nul
copy setup.bat dist\whatsapp-sales-assistant\ >nul

:: Node modules (this is large - includes Chromium for Puppeteer)
echo [*] Copying node_modules (this may take a minute)...
xcopy /e /i /q node_modules dist\whatsapp-sales-assistant\node_modules >nul

:: Create README
(
echo WhatsApp Sales Assistant
echo ========================
echo.
echo Quick Start:
echo 1. Double-click setup.bat - configure your API key
echo 2. Double-click start.bat - launch the application
echo 3. Open http://localhost:3000 in your browser
echo.
echo First time: scan the QR code in data/whatsapp-qr.png
echo with WhatsApp on your phone.
echo.
echo Requirements:
echo - Windows 10/11
echo - Node.js 18+ (https://nodejs.org)
echo - Chrome browser (for WhatsApp Web backend)
) > dist\whatsapp-sales-assistant\README.txt

:: Create zip
echo [*] Creating zip file...
powershell -Command "Compress-Archive -Path 'dist\whatsapp-sales-assistant\*' -DestinationPath 'dist\WhatsApp-Sales-Assistant.zip' -Force"

echo.
echo ============================================
echo   Build complete!
echo.
echo   Distribution package: dist\WhatsApp-Sales-Assistant.zip
echo ============================================
echo.
echo To deploy on another computer:
echo   1. Copy the zip file to the target computer
echo   2. Extract to any folder
echo   3. Run setup.bat (first time only)
echo   4. Run start.bat
echo.
pause
