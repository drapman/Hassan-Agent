/**
 * Telegram Userbot - منشی هوشمند اکانت شخصی تلگرام
 * 
 * پاسخگویی خودکار و هوشمند به پیام‌های خصوصی در تلگرام شخصی شما
 */

require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { GoogleGenAI } = require('@google/genai');

const apiId = 2040;
const apiHash = 'b18441a1ff607e10a989891a5462e627';
const session = process.env.TELEGRAM_USER_SESSION || '';

let client = null;
const repliedRecently = new Map(); // جلوگیری از اسپم (کول‌داون برای هر کاربر)

// تنظیم هوش مصنوعی برای منشی
let ai = null;
if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

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

        // گوش دادن به پیام‌های جدید
        client.addEventHandler(async (event) => {
            try {
                const message = event.message;
                
                // فقط پیام‌های خصوصی جدید (نه گروه‌ها، نه کانال‌ها و نه پیام‌هایی که خودمان می‌فرستیم)
                if (!event.isPrivate || message.out) return;

                const sender = await message.getSender();
                if (!sender) return;

                const senderId = sender.id?.toString();
                const senderName = sender.firstName || sender.username || 'یک مخاطب';
                const messageText = message.text || '';

                // نادیده گرفتن اعلان‌های رسمی تلگرام (777000) یا پیام‌های خالی
                if (senderId === '777000' || !messageText.trim()) return;

                // بررسی کول‌داون (جلوگیری از پاسخ مکرر در کمتر از ۲ دقیقه به یک نفر)
                const now = Date.now();
                const lastTime = repliedRecently.get(senderId) || 0;
                if (now - lastTime < 2 * 60 * 1000) {
                    return; // قبلاً در ۲ دقیقه اخیر پاسخ داده شده
                }

                console.log(`📩 [پی‌وی شخصی] پیام جدید از ${senderName}: "${messageText}"`);

                // تولید پاسخ هوشمندانه با هوش مصنوعی
                let autoReply = '';
                if (ai) {
                    try {
                        const prompt = `تو دستیار و منشی شخصی حسن در اکانت تلگرامش هستی. یک نفر در پی‌وی به حسن این پیام را فرستاده است:
"${messageText}"

حسن در حال حاضر ممکن است آنلاین نباشد یا سرش شلوغ باشد. یک پاسخ بسیار کوتاه (حداکثر ۱ یا ۲ جمله)، خیلی محترمانه، گرم و خودمانی بنویس. بگو پیامش را دریافت کردی و به حسن اطلاع می‌دهی تا در اولین فرصت پاسخ دهد. اگر سوال مشخص و ساده‌ای پرسیده، راهنمایی کوتاهی بکن. حتماً خودت را به عنوان «دستیار/منشی حسن» معرفی کن تا طرف بداند با هوش مصنوعی صحبت می‌کند.`;

                        const res = await ai.models.generateContent({
                            model: 'gemini-3.5-flash-lite',
                            contents: prompt,
                        });
                        autoReply = res.text?.trim();
                    } catch (e) {
                        console.warn('⚠️ خطا در ساخت پاسخ منشی با Gemini:', e.message);
                    }
                }

                if (!autoReply) {
                    autoReply = `سلام ${senderName} عزیز! من دستیار هوشمند حسن هستم. حسن در حال حاضر آنلاین نیست، پیامت رو ثبت کردم و به محض اینکه آنلاین بشه بهش اطلاع میدم. 🙏`;
                }

                // ارسال پاسخ به پی‌وی طرف
                await event.respond({ message: autoReply });
                repliedRecently.set(senderId, now);
                console.log(`🤖 [منشی شخصی] پاسخ به ${senderName} ارسال شد.`);

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
