@echo off
title WhatsApp Sales Assistant - Setup
cd /d "%~dp0"

echo ============================================
echo   WhatsApp Sales Assistant - First Setup
echo ============================================
echo.
echo This will configure your API key and settings.
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo.
    echo Please install Node.js from: https://nodejs.org
    echo Download the LTS version and install it first.
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js found: 
node -v
echo.

:: Create .env if not exists
if exist .env (
    echo [!] .env already exists. Delete it to reconfigure.
    echo.
    set /p RECONF="Reconfigure? (y/n): "
    if /i not "%RECONF%"=="y" goto :skip_env
    del .env
)

echo --- API Configuration ---
echo.
echo You need a DeepSeek API key.
echo Get one at: https://platform.deepseek.com/api_keys
echo.

set /p API_KEY="Enter your DeepSeek API key: "
if "%API_KEY%"=="" (
    echo [ERROR] API key is required!
    pause
    exit /b 1
)

echo.
echo --- WhatsApp Settings ---
echo.
set /p PHONE="Enter your WhatsApp phone number (e.g. 8613800138000): "

echo.
echo --- License Key ---
echo.
echo If you have a license key, enter it here.
echo (Leave blank if not required)
echo.
set /p LICENSE_KEY="License key: "


echo.
echo --- Writing configuration... ---

(
echo # DeepSeek API
echo LLM_BASE_URL=https://api.deepseek.com/v1
echo LLM_API_KEY=%API_KEY%
echo LLM_MODEL=deepseek-chat
echo.
echo # Language settings
echo USER_NATIVE_LANG=zh
echo CUSTOMER_LANG=en
echo.
echo # Context window
echo CONTEXT_WINDOW=10
echo.
echo # WhatsApp phone
echo WHATSAPP_PHONE_NUMBER=%PHONE%
echo.
echo # License
echo LICENSE_KEY=%LICENSE_KEY%
echo.
echo # Data storage
echo DATA_PATH=./data
) > .env

echo.
echo [OK] Configuration saved!
echo.

:skip_env
echo.
echo --- Installing dependencies (this may take a few minutes) ---
echo.
call npm install

echo.
echo ============================================
echo   Setup complete!
echo.
echo   To start: double-click start.bat
echo ============================================
echo.
pause
