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
const userSessions = new Map(); // حافظه گفتگوی چند مرحله‌ای مخاطبان
const activeHumanChats = new Map(); // مخاطبانی که خود پوریا با آنها چت کرده است

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

                // ۱. اگر خودمان دستی به کسی پیام دادیم، منشی در این مکالمه تا ۳۰ دقیقه سکوت کند
                if (message.out) {
                    const peerId = message.peerId?.userId?.toString();
                    if (peerId) {
                        activeHumanChats.set(peerId, Date.now());
                        userSessions.delete(peerId);
                    }
                    return;
                }

                // فقط پیام‌های خصوصی جدید (نه گروه‌ها، نه کانال‌ها)
                if (!event.isPrivate) return;

                const sender = await message.getSender();
                if (!sender) return;

                const senderId = sender.id?.toString();
                const senderName = sender.firstName || sender.username || 'یک مخاطب';
                const messageText = (message.text || '').trim();

                // فیلترهای حیاتی:
                // ۲. نادیده گرفتن تمام ربات‌ها (جلوگیری از لوپ بی‌پایان با ربات خودمان یا ربات‌های دیگر)
                if (sender.bot || senderId === ourBotId) return;

                // ۳. نادیده گرفتن پیام‌های ارسالی از خودمان، ذخیره پیام‌ها (Saved Messages) و تلگرام رسمی
                if (senderId === myId || senderId === '777000' || !messageText) return;

                // ۴. بررسی فعال بودن قابلیت پاسخ خودکار
                if (process.env.TELEGRAM_AUTO_REPLY === 'false') return;

                const now = Date.now();

                // ۵. بررسی مکالمه زنده توسط پوریا (اگر خودت پیام دادی، منشی دخالت نمی‌کنه)
                const lastHumanChatTime = activeHumanChats.get(senderId) || 0;
                if (now - lastHumanChatTime < 30 * 60 * 1000) {
                    return; // پوریا اخیراً با این مخاطب چت کرده، منشی ساکت می‌ماند
                }

                // ۶. مدیریت سشن گفتگو (حافظه تاریخچه چت منشی با مخاطب)
                let sessionData = userSessions.get(senderId);
                // اگر بیش از ۱۵ دقیقه از آخرین پیام گذشته باشد، مکالمه جدید شروع می‌شود
                if (!sessionData || (now - sessionData.lastTime > 15 * 60 * 1000)) {
                    sessionData = { history: [], lastTime: now, messageCount: 0 };
                    userSessions.set(senderId, sessionData);
                }

                // بررسی سقف پیام‌ها در یک جلسه (برای جلوگیری از سوءاستفاده یا اسپم بی‌پایان)
                if (sessionData.messageCount >= 7) {
                    return; // بیشتر از ۷ رفت و برگشت سکوت کن تا خود پوریا ببیند
                }

                console.log(`📩 [پی‌وی شخصی] پیام جدید از ${senderName} (پیام #${sessionData.messageCount + 1}): "${messageText}"`);

                const isFirstMessage = sessionData.history.length === 0;

                // اضافه کردن پیام کاربر به تاریخچه مکالمه
                sessionData.history.push({ role: 'user', content: messageText });
                sessionData.lastTime = now;
                sessionData.messageCount++;

                // ساخت پرامپت هوشمند منشی پویا
                const systemInstruction = `تو «حسن» هستی؛ دستیار و منشی شخصی بسیار باهوش، گرم، لوتی و مودب «پوریا» در اکانت تلگرامش.
پوریا در حال حاضر آنلاین نیست یا سرش شلوغ است و تو وظیفه داری با این مخاطب چت کنی تا بفهمی کارش چیه، نیازش چیه و پیام یا درخواستش را ثبت کنی تا دقیق به پوریا انتقال دهی.

قوانین گفتگو:
۱. لحنت کاملاً طبیعی، گرم، خودمانی و صمیمی باشد (اصلاً متن رباتی، تکراری یا خشک نباشد).
۲. ${isFirstMessage 
    ? 'این پیام اول این مخاطب است. خیلی کوتاه و گرم بگو من حسن (منشی پوریا) هستم، پوریا الان آنلاین نیست. بپرس چه امری یا کاری داشته تا یادداشت کنی و به پوریا بگی.' 
    : 'مکالمه قبلاً شروع شده است. دیگر اصلاً خودت را معرفی نکن! مستقیماً و کاملاً مرتبط با آخرین صحبت مخاطب، با او گفتگو کن. اگر کارش را گفت، بگو کامل یادداشت کردی و پیگیری می‌کنی یا اگر سوالی پرسیده پاسخ کوتاه و راهنمایی بده.'}
۳. پاسخ‌هایت حتماً کوتاه (حداکثر ۱ یا ۲ جمله)، پویا و مکالمه‌محور باشد.
۴. اگر کلمه «پوریا» لازم بود، نهایتاً یک‌بار در کل پیامت بیاور.`;

                let autoReply = '';
                try {
                    const messagesForAI = [
                        { role: 'system', content: systemInstruction },
                        ...sessionData.history.slice(-6)
                    ];

                    autoReply = await askAI({
                        systemInstruction,
                        messages: messagesForAI,
                        prompt: messageText
                    });
                } catch (aiErr) {
                    console.warn('⚠️ خطا در دریافت پاسخ از هوش مصنوعی برای منشی:', aiErr.message);
                }

                if (!autoReply) {
                    if (isFirstMessage) {
                        autoReply = `سلام ${senderName} عزیز! من حسن هستم، منشی پوریا. پوریا الان آنلاین نیست، امری یا کاری داشتی بگو من یادداشت کنم و بهش بگم. 🙏`;
                    } else {
                        autoReply = `حله، کامل یادداشت کردم و به پوریا اطلاع میدم تا در اولین فرصت خودش پیامت رو بخونه و جوابت رو بده.`;
                    }
                }

                // ثبت پاسخ منشی در تاریخچه
                sessionData.history.push({ role: 'assistant', content: autoReply });

                // ارسال پاسخ به پی‌وی مخاطب
                try {
                    await client.sendMessage(senderId, { message: autoReply });
                    console.log(`🤖 [منشی شخصی] پاسخ مرحله ${sessionData.messageCount} به ${senderName} ارسال شد.`);
                } catch (sendErr) {
                    console.error('❌ خطا در ارسال پیام منشی:', sendErr.message);
                }

                // ارسال گزارش زنده به خود مالک در ربات دستیار
                if (botInstance && process.env.TELEGRAM_OWNER_ID) {
                    const alertMsg = `📢 *مکالمه منشی با ${senderName}:*\n\n💬 *پیام مخاطب:* "${messageText}"\n🤖 *پاسخ حسن:* "${autoReply}"\n\n_(مرحله ${sessionData.messageCount} مکالمه)_`;
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
