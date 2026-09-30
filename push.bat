@echo off
chcp 65001 >nul
title Push Hassan Agent to Git

echo.
echo ========================================================
echo          🚀 ارسال تغییرات حسن ربات به گیت‌هاب
echo ========================================================
echo.

:: بررسی وجود ریپازیتوری گیت
if not exist ".git" (
    echo [ERROR] پوشه گیت (.git) پیدا نشد!
    echo لطفاً مطمئن شوید در پوشه Hassan Agent هستید.
    pause
    exit /b 1
)

:: نمایش وضعیت فایل‌های تغییر یافته
echo [INFO] بررسی وضعیت فایل‌ها:
git status -s
echo.

:: دریافت پیام کامیت از کاربر
set /p commit_msg="لطفاً پیام کامیت را وارد کنید (خالی بگذارید تا خودکار ثبت شود): "

if "%commit_msg%"=="" (
    set commit_msg=Update Hassan Agent - %date% %time%
)

echo.
echo [1/3] در حال افزودن فایل‌ها به استیج (git add)...
git add .

echo [2/3] در حال ثبت کامیت (git commit)...
git commit -m "%commit_msg%"

echo [3/3] در حال ارسال به گیت‌هاب (git push)...
git push origin main

if errorlevel 1 (
    echo.
    echo ❌ خطا در ارسال به گیت‌هاب!
    echo اگر خطا به دلیل تغییرات ریموت است، ابتدا دستور زیر را در ترمینال بزنید:
    echo git pull --rebase origin main
) else (
    echo.
    echo ✅ تغییرات با موفقیت در گیت‌هاب ذخیره شدند!
)

echo.
pause
