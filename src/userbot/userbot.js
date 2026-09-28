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

                // اگر پیام اول مخاطب است، بلافاصله به پوریا اطلاع بده
                if (isFirstMessage && botInstance && process.env.TELEGRAM_OWNER_ID) {
                    const initialAlert = `🔔 *پیام جدید در پی‌وی شما!*\n\n` +
                        `👤 *از طرف:* ${senderName}\n` +
                        `💬 *متن پیام:* "${messageText}"\n\n` +
                        `⏳ _حسن در حال گفتگو با مخاطب است. پس از پایان چت، خلاصه هدف و پیامش برای شما ارسال می‌شود._`;
                    botInstance.telegram.sendMessage(process.env.TELEGRAM_OWNER_ID, initialAlert, { parse_mode: 'Markdown' }).catch(() => {});
                }

                // ساخت پرامپت هوشمند و پویا بر اساس مرحله گفتگو
                const count = sessionData.messageCount;
                let phaseGuidance = '';

                if (count === 1) {
                    phaseGuidance = 'این اولین پیام مخاطب است. خیلی خودمانی، باادب و صمیمی بگو من حسن هستم، منشی پوریا. پوریا الان آنلاین نیست یا سرش شلوغه. بگو بفرما جانم چه امری داشتی بگو تا دقیق بهش بگم؟';
                } else if (count >= 2 && count <= 3) {
                    phaseGuidance = 'مکالمه در حال پیشرفت است. اصلاً خودت را دوباره معرفی نکن و سلام تکراری نده! به حرف‌ها یا سوال مخاطب پاسخ طبیعی و مرتبط بده، پیگیر کارش باش و مثل دو تا رفیق باهاش چت کن تا کامل بفهمی موضوع چیه.';
                } else if (count === 4 || count === 5) {
                    phaseGuidance = 'چندین پیام رد و بدل شده و وقت جمع‌بندی است. خودمانی و باحال بهش بگو: «اگر کار دیگه‌ای هم با پوریا داری بگو تا کامل یادداشت کنم، وگرنه منم جای دیگه دستم بنده و سرم شلوغه باید به بقیه کارا برسم!».';
                } else {
                    phaseGuidance = 'مکالمه تمام است. خیلی گرم، لوتی و خودمانی گفتگو را جمع کن و خداحافظی کن (مثلاً: «حله داداش، همه چی ثبت شد و به پوریا میگم خودش بیاد پیویت. فعلاً دمت گرم، روزت خوش»).';
                }

                const systemInstruction = `تو «حسن» هستی؛ دستیار و منشی شخصی پوریا. بسیار خونگرم، لوتی، خاکی، باادب و باهوش.
پوریا الان نیست و تو داری در پی‌وی تلگرام با این شخص چت می‌کنی.

دستورالعمل این مرحله:
${phaseGuidance}

قوانین ثابت:
۱. کاملاً طبیعی و ایرانی صحبت کن، انگار یک آدم واقعی پشت کیبورده (اصلاً جملات تکراری، کلیشه‌ای یا خشک نزن).
۲. پاسخ‌ها کوتاه، روان و حداکثر ۱ تا ۲ جمله باشد.
۳. در صورت نیاز به اسم پوریا، نهایتاً یک‌بار در کل جمله‌ات نامش را بیاور.`;

                let autoReply = '';
                try {
                    const messagesForAI = [
                        { role: 'system', content: systemInstruction },
                        ...sessionData.history.slice(-8)
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
                    if (count === 1) {
                        autoReply = `سلام ${senderName} عزیز! من حسنم، منشی پوریا. پوریا الان آنلاین نیست، بفرما جانم امری داشتی بگو من ثبت کنم و بهش بگم.`;
                    } else if (count >= 4) {
                        autoReply = `حله، اگه کار دیگه‌ای هم با پوریا داری بگو یادداشت کنم، وگرنه منم باید برم به کارام برسم سرم شلوغه! 🙏`;
                    } else {
                        autoReply = `متوجه شدم، مورد دیگه‌ای هم هست یا دقیقاً همینو به پوریا منتقل کنم؟`;
                    }
                }

                // ثبت پاسخ منشی در تاریخچه
                sessionData.history.push({ role: 'assistant', content: autoReply });

                // ارسال پاسخ به پی‌وی مخاطب
                try {
                    await client.sendMessage(senderId, { message: autoReply });
                    console.log(`🤖 [منشی شخصی] پاسخ مرحله ${count} به ${senderName} ارسال شد.`);
                } catch (sendErr) {
                    console.error('❌ خطا در ارسال پیام منشی:', sendErr.message);
                }

                // اگر مکالمه به جمع‌بندی رسید (پیام ۶ به بعد)، سریع‌تر خلاصه را بفرست
                const summaryDelay = count >= 5 ? 40 * 1000 : 2 * 60 * 1000;

                if (sessionData.summaryTimer) {
                    clearTimeout(sessionData.summaryTimer);
                }
                sessionData.summaryTimer = setTimeout(async () => {
                    await sendChatSummary(botInstance, senderId, senderName, sessionData);
                }, summaryDelay);

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

/**
 * ارسال گزارش و خلاصه گفتگوی منشی به تلگرام پوریا پس از پایان چت
 */
async function sendChatSummary(botInstance, senderId, senderName, sessionData) {
    if (!botInstance || !process.env.TELEGRAM_OWNER_ID) return;
    if (!sessionData || !sessionData.history || sessionData.history.length <= 1) return;

    try {
        console.log(`📝 در حال تحلیل و ساخت خلاصه گفتگوی منشی با ${senderName}...`);

        const chatLog = sessionData.history
            .map(m => `${m.role === 'user' ? senderName : 'حسن (منشی)'}: ${m.content}`)
            .join('\n');

        const summaryPrompt = `گفتگوی زیر بین یک مخاطب به نام (${senderName}) و منشی هوشمند (${'حسن'}) در تلگرام پوریا انجام شده است:
${chatLog}

یک خلاصه بسیار مرتب، شفاف و شسته‌رفته در ۲ الی ۳ خط بنویس که دقیقاً بگوید:
۱. موضوع و هدف اصلی مخاطب چی بود؟
۲. در نهایت چه نتیجه‌ای حاصل شد یا چه پیامی/درخواستی برای پوریا گذاشت؟
لحن خلاصه کاملاً واضح، خلاصه، محترمانه و مفید باشد.`;

        const summary = await askAI({
            prompt: summaryPrompt,
            systemInstruction: 'تو دستیار گزارش‌دهی پوریا هستی. خلاصه گفتگوی تلگرام را بسیار تمیز، مختصر و مفید بنویس.'
        });

        const reportMsg = `📋 *گزارش پایان گفتگو با ${senderName}*\n\n` +
            `🎯 *خلاصه هدف و نتیجه گفتگو:*\n${summary.trim()}\n\n` +
            `💬 *تعداد تبادل پیام:* ${Math.ceil(sessionData.history.length / 2)}\n` +
            `🕒 *زمان اتمام:* ${new Date().toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran' })}`;

        await botInstance.telegram.sendMessage(process.env.TELEGRAM_OWNER_ID, reportMsg, { parse_mode: 'Markdown' });
        console.log(`✅ خلاصه گفتگوی منشی با ${senderName} برای پوریا ارسال شد.`);
    } catch (err) {
        console.error('❌ خطا در ارسال خلاصه گفتگو:', err.message);
    }
}

module.exports = { startUserbot };

