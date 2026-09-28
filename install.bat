@echo off
chcp 65001 >nul
echo.
echo ╔════════════════════════════════════╗
echo ║     Hassan Agent - Install        ║
echo ╚════════════════════════════════════╝
echo.

:: بررسی Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js نصب نیست!
    echo لطفاً Node.js را از https://nodejs.org دانلود و نصب کنید
    pause
    exit /b 1
)

echo [OK] Node.js پیدا شد: 
node --version

echo.
echo [INFO] در حال نصب وابستگی‌ها...
npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] نصب ناموفق!
    pause
    exit /b 1
)

echo.
echo [SUCCESS] نصب با موفقیت انجام شد!
echo.
echo ╔════════════════════════════════════════╗
echo ║  مرحله بعد: تنظیم فایل .env          ║
echo ║                                        ║
echo ║  1. فایل .env را باز کن               ║
echo ║  2. مقادیر زیر را وارد کن:           ║
echo ║     - GEMINI_API_KEY                   ║
echo ║     - TELEGRAM_BOT_TOKEN              ║
echo ║     - TELEGRAM_OWNER_ID               ║
echo ║                                        ║
echo ║  سپس start.bat را اجرا کن             ║
echo ╚════════════════════════════════════════╝
echo.
pause
