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

    // راه‌اندازی سرور سلامتی برای هاست‌های ابری (Render / Koyeb / Railway)
    const http = require('http');
    const PORT = process.env.PORT || 3000;
    http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            agent: 'Hassan AI Agent',
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString()
        }));
    }).listen(PORT, () => {
        console.log(`🌐 سرور سلامتی برای هاست ابری روی پورت ${PORT} فعال است.`);
    });

    try {
        await startBot();

        const { bot } = require('./src/telegram/bot');

        // راه‌اندازی دیده‌بان زنده کاربران جدید سایت (اعلان فوری ثبت‌نام به تلگرام)
        const { startNewUserWatcher } = require('./src/watchers/newUserWatcher');
        startNewUserWatcher(bot);

        // راه‌اندازی منشی هوشمند اکانت شخصی تلگرام (Userbot)
        const { startUserbot } = require('./src/userbot/userbot');
        await startUserbot(bot);
    } catch (error) {
        console.error('❌ خطا در راه‌اندازی:', error.message);
        
        if (error.message.includes('401')) {
            console.error('⚠️  توکن بات اشتباه است. TELEGRAM_BOT_TOKEN را در .env بررسی کنید.');
        } else if (error.message.includes('GEMINI')) {
            console.error('⚠️  GEMINI_API_KEY نامعتبر است. کلید API را بررسی کنید.');
        }
        
        process.exit(1);
    }
}

main();
