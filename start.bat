@echo off
chcp 65001 >nul
echo.
echo ╔════════════════════════════════════╗
echo ║    Hassan Agent - Starting...     ║
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
    npm install
)

echo [INFO] در حال راه‌اندازی Agent...
echo [INFO] برای خاموش کردن Ctrl+C بزن
echo.
node index.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Agent با خطا متوقف شد.
    pause
)
