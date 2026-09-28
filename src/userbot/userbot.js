/**
 * Telegram Userbot - منشی هوشمند اکانت شخصی تلگرام
 * 
 * پاسخگویی خودکار و هوشمند به پیام‌های خصوصی در تلگرام شخصی شما
 */

require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { askAI } = require('../agent/aiRouter');

const apiId = 2040;
const apiHash = 'b18441a1ff607e10a989891a5462e627';
const session = process.env.TELEGRAM_USER_SESSION || '';

let client = null;
const repliedRecently = new Map(); // جلوگیری از اسپم (کول‌داون برای هر کاربر)

/**
 * راه‌اندازی منشی هوشمند روی اکانت شخصی
 * @param {object} botInstance - نمونه ربات اصلی تلگرام برای ارسال اعلان به مالک
 */
async function startUserbot(botInstance = null) {
    if (!session) {
        console.log('ℹ️  منشی اکانت شخصی (Userbot) تنظیم نشده است. (TELEGRAM_USER_SESSION خالی است)');
        return null;
    }

    try {
        console.log('🚀 در حال اتصال منشی هوشمند به اکانت تلگرام شخصی...');
        const stringSession = new StringSession(session);
        client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
        });

        await client.connect();
        const me = await client.getMe();
        console.log(`✅ منشی اکانت شخصی فعال شد روی شماره/اکانت: ${me.firstName} (@${me.username || 'بدون یوزرنیم'})`);

        const myId = me.id?.toString();
        const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
        const ourBotId = botToken.split(':')[0];

        // گوش دادن به پیام‌ها
        client.addEventHandler(async (event) => {
            try {
                const message = event.message;
                if (!message) return;

                // اگر خودمان به کسی پیام دادیم، زمانش را ثبت کن تا منشی در مکالمه زنده دخالت نکند
                if (message.out) {
                    const peerId = message.peerId?.userId?.toString();
                    if (peerId) repliedRecently.set(peerId, Date.now());
                    return;
                }

                // فقط پیام‌های خصوصی (نه گروه‌ها، نه کانال‌ها)
                if (!event.isPrivate) return;

                const sender = await message.getSender();
                if (!sender) return;

                const senderId = sender.id?.toString();
                const senderName = sender.firstName || sender.username || 'یک مخاطب';
                const messageText = message.text || '';

                // فیلترهای حیاتی:
                // ۱. نادیده گرفتن تمام ربات‌ها (جلوگیری از لوپ بی‌پایان با ربات خودمان یا ربات‌های دیگر)
                if (sender.bot || senderId === ourBotId) return;

                // ۲. نادیده گرفتن پیام‌های ارسالی از خودمان، ذخیره پیام‌ها (Saved Messages) و تلگرام رسمی
                if (senderId === myId || senderId === '777000' || !messageText.trim()) return;

                // ۳. بررسی فعال بودن قابلیت پاسخ خودکار
                if (process.env.TELEGRAM_AUTO_REPLY === 'false') return;

                // ۴. بررسی کول‌داون (حداقل ۱۰ دقیقه سکوت بین دو پاسخ خودکار به یک فرد مشخص)
                const now = Date.now();
                const lastTime = repliedRecently.get(senderId) || 0;
                if (now - lastTime < 10 * 60 * 1000) {
                    return; // قبلاً در ۱۰ دقیقه اخیر پاسخ داده شده یا شما در حال چت با او هستید
                }

                console.log(`📩 [پی‌وی شخصی] پیام جدید از ${senderName}: "${messageText}"`);

                // تولید پاسخ هوشمندانه با هوش مصنوعی (سوئیچ خودکار بین Groq, OpenRouter, Gemini)
                let autoReply = '';
                try {
                    const prompt = `یک نفر در پی‌وی تلگرام به حسن این پیام را فرستاده است:
"${messageText}"

یک پاسخ بسیار کوتاه (حداکثر ۱ یا ۲ جمله)، خیلی محترمانه، گرم و خودمانی بنویس. بگو پیامش را دریافت کردی و به حسن اطلاع می‌دهی تا در اولین فرصت پاسخ دهد. اگر سوال مشخص و ساده‌ای پرسیده، راهنمایی کوتاهی بکن. خودت را «دستیار/منشی حسن» معرفی کن.`;

                    const systemInstruction = 'تو دستیار و منشی شخصی و هوشمند حسن در اکانت تلگرامش هستی. وظیفه‌ات پاسخ محترمانه و خودمانی به پیام‌های پی‌وی در غیاب حسن است.';

                    autoReply = await askAI({ prompt, systemInstruction });
                } catch (aiErr) {
                    console.warn('⚠️ خطا در دریافت پاسخ از هوش مصنوعی برای منشی:', aiErr.message);
                }

                if (!autoReply) {
                    autoReply = `سلام ${senderName} عزیز! من دستیار هوشمند حسن هستم. حسن در حال حاضر آنلاین نیست، پیامت رو ثبت کردم و به محض اینکه آنلاین بشه بهش اطلاع میدم. 🙏`;
                }

                // ارسال پاسخ به پی‌وی طرف
                try {
                    await client.sendMessage(senderId, { message: autoReply });
                    repliedRecently.set(senderId, now);
                    console.log(`🤖 [منشی شخصی] پاسخ به ${senderName} ارسال شد.`);
                } catch (sendErr) {
                    console.error('❌ خطا در ارسال پیام منشی:', sendErr.message);
                }

                // ارسال اعلان به خود مالک در ربات دستیار
                if (botInstance && process.env.TELEGRAM_OWNER_ID) {
                    const alertMsg = `📢 *پیام جدید در پی‌وی اکانت شما!*\n\n👤 *از طرف:* ${senderName}\n💬 *متن پیام:* "${messageText}"\n\n🤖 *پاسخ خودکار منشی:*\n"${autoReply}"`;
                    await botInstance.telegram.sendMessage(process.env.TELEGRAM_OWNER_ID, alertMsg, { parse_mode: 'Markdown' }).catch(() => {});
                }

            } catch (err) {
                console.error('❌ خطا در رویداد پیام منشی:', err.message);
            }
        }, new NewMessage({ incoming: true }));

        return client;
    } catch (error) {
        console.error('❌ خطا در راه‌اندازی منشی اکانت شخصی:', error.message);
        return null;
    }
}

module.exports = { startUserbot };
