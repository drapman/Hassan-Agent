/**
 * Hassan Agent - Entry Point
 * نقطه شروع برنامه
 */

require('dotenv').config();

const { startBot } = require('./src/telegram/bot');

async function main() {
    console.log('╔════════════════════════════════════╗');
    console.log('║       Hassan AI Agent v1.0         ║');
    console.log('║   دستیار هوش مصنوعی شخصی          ║');
    console.log('╚════════════════════════════════════╝\n');

    // راه‌اندازی سرور مینی‌اپ تلگرام (Telegram Mini App) و داشبورد مدیریت
    const { createWebAppServer } = require('./src/server/webAppServer');
    const PORT = process.env.PORT || 3000;
    const app = createWebAppServer();
    app.listen(PORT, () => {
        console.log(`🌐 سرور داشبورد و مینی‌اپ تلگرام روی پورت ${PORT} فعال است.`);
        console.log(`📱 آدرس محلی داشبورد: http://localhost:${PORT}`);
    });

    async function launchBotWithRetry(retries = 5) {
        try {
            await startBot();
            const { bot } = require('./src/telegram/bot');
            const { startNewUserWatcher } = require('./src/watchers/newUserWatcher');
            startNewUserWatcher(bot);
        } catch (error) {
            console.error('❌ خطا در اتصال به تلگرام:', error.message);
            if (error.message.includes('401')) {
                console.error('⚠️ توکن بات اشتباه است. TELEGRAM_BOT_TOKEN را در .env بررسی کنید.');
            } else if (retries > 0) {
                console.log(`🔄 تلاش مجدد برای اتصال به تلگرام تا ۵ ثانیه دیگر... (${retries} تلاش باقی‌مانده)`);
                setTimeout(() => launchBotWithRetry(retries - 1), 5000);
            } else {
                console.warn('⚠️ اتصال به تلگرام ناموفق بود، اما سرور وب و مینی‌اپ همچنان در حال اجراست.');
            }
        }
    }

    launchBotWithRetry();
}

main();
