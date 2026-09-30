@echo off
chcp 65001 >nul
title Hassan AI Agent

echo.
echo ╔════════════════════════════════════╗
echo ║       Hassan AI Agent v1.0         ║
echo ║   دستیار هوش مصنوعی شخصی          ║
echo ╚════════════════════════════════════╝
echo.

:: بررسی فایل .env
if not exist ".env" (
    echo [ERROR] فایل .env پیدا نشد!
    echo لطفاً از .env.example کپی بگیرید و تنظیمات را وارد کنید.
    pause
    exit /b 1
)

:: بررسی node_modules
if not exist "node_modules" (
    echo [INFO] در حال نصب وابستگی‌ها...
    call npm install
)

:: راه‌اندازی خودکار تونل ngrok برای مینی‌اپ تلگرام
tasklist /fi "imagename eq ngrok.exe" | findstr /i "ngrok.exe" >nul
if errorlevel 1 (
    echo [INFO] در حال راه‌اندازی تونل ngrok برای مینی‌اپ تلگرام...
    start "Ngrok Tunnel (Telegram Mini App)" /min ngrok http 3000 --url=gorgeous-germicide-backfire.ngrok-free.dev
    timeout /t 3 >nul
) else (
    echo [OK] تونل ngrok از قبل در حال اجراست.
)

:loop
echo.
echo [INFO] در حال راه‌اندازی Agent...
echo [INFO] برای متوقف کردن این پنجره را ببندید یا Ctrl+C بزنید.
echo.

node index.js

echo.
echo [WARN] برنامه متوقف شد. راه‌اندازی مجدد خودکار در ۵ ثانیه...
echo (برای توقف کامل، پنجره را ببندید یا Ctrl+C بزنید)
timeout /t 5 >nul
goto loop

