/**
 * لاگین یک‌باره به اکانت شخصی تلگرام برای ساخت سشن منشی هوشمند
 */

require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');

// کلیدهای رسمی تلگرام دسکتاپ
const apiId = 2040;
const apiHash = 'b18441a1ff607e10a989891a5462e627';
const stringSession = new StringSession('');

(async () => {
    console.log('╔═════════════════════════════════════════════════════════╗');
    console.log('║   فعال‌سازی منشی هوشمند روی اکانت شخصی تلگرام (Userbot)   ║');
    console.log('╚═════════════════════════════════════════════════════════╝\n');

    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    try {
        await client.start({
            phoneNumber: async () => await input.text('📞 شماره موبایل تلگرام با کد کشور (مثلاً +989123456789): '),
            password: async () => await input.text('🔒 رمز تأیید دومرحله‌ای (اگر نداری Enter بزن): '),
            phoneCode: async () => await input.text('📩 کد ۵ رقمی که تلگرام برات فرستاد رو وارد کن: '),
            onError: (err) => console.error('❌ خطا:', err.message),
        });

        console.log('\n🎉 عالیه! با موفقیت به اکانت شخصی تلگرامت وصل شدی.');
        const sessionString = client.session.save();

        // ذخیره در .env
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            let env = fs.readFileSync(envPath, 'utf8');
            if (env.includes('TELEGRAM_USER_SESSION=')) {
                env = env.replace(/TELEGRAM_USER_SESSION=.*/, `TELEGRAM_USER_SESSION=${sessionString}`);
            } else {
                env += `\n# 👤 سشن منشی هوشمند اکانت شخصی\nTELEGRAM_USER_SESSION=${sessionString}\nTELEGRAM_AUTO_REPLY=true\n`;
            }
            fs.writeFileSync(envPath, env, 'utf8');
            console.log('✅ سشن در فایل .env ذخیره شد.');
        }

        console.log('\n🔑 سشن ایجاد شده برای سرور ابری Render:');
        console.log('─────────────────────────────────────────────────────────');
        console.log(sessionString);
        console.log('─────────────────────────────────────────────────────────');
        console.log('📌 این سشن را در بخش Environment سرور Render هم اضافه کنید:');
        console.log('Key: TELEGRAM_USER_SESSION');
        console.log('Value: (متن سشن بالا)');

        await client.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ خطا در ورود:', error.message);
        process.exit(1);
    }
})();
