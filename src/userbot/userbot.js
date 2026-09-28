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
const { contacts } = require('../database/db');

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
                const senderUsername = sender.username || '';
                const senderFirstName = sender.firstName || '';
                const senderLastName = sender.lastName || '';
                const senderName = senderFirstName || senderUsername || 'یک مخاطب';
                const messageText = (message.text || '').trim();

                // فیلترهای حیاتی:
                // ۲. نادیده گرفتن تمام ربات‌ها (جلوگیری از لوپ بی‌پایان با ربات خودمان یا ربات‌های دیگر)
                if (sender.bot || senderId === ourBotId) return;

                // ۳. نادیده گرفتن پیام‌های ارسالی از خودمان، ذخیره پیام‌ها (Saved Messages) و تلگرام رسمی
                if (senderId === myId || senderId === '777000' || !messageText) return;

                // ۴. ذخیره مشخصات کاربر در حافظه دیتابیس SQLite
                try {
                    contacts.save({
                        telegram_id: senderId,
                        username: senderUsername,
                        first_name: senderFirstName,
                        last_name: senderLastName,
                        last_message: messageText
                    });
                } catch (e) {
                    console.warn('⚠️ خطا در ذخیره مخاطب در دیتابیس:', e.message);
                }

                // ۵. بررسی فعال بودن قابلیت پاسخ خودکار
                if (process.env.TELEGRAM_AUTO_REPLY === 'false') return;

                const now = Date.now();

                // ۶. بررسی مکالمه زنده توسط پوریا (اگر خودت پیام دادی، منشی دخالت نمی‌کنه)
                const lastHumanChatTime = activeHumanChats.get(senderId) || 0;
                if (now - lastHumanChatTime < 30 * 60 * 1000) {
                    return; // پوریا اخیراً با این مخاطب چت کرده، منشی ساکت می‌ماند
                }

                // ۷. مدیریت سشن گفتگو (حافظه تاریخچه چت منشی با مخاطب)
                let sessionData = userSessions.get(senderId);
                // اگر بیش از ۱۵ دقیقه از آخرین پیام گذشته باشد، مکالمه جدید شروع می‌شود
                if (!sessionData || (now - sessionData.lastTime > 15 * 60 * 1000)) {
                    sessionData = {
                        history: [],
                        lastTime: now,
                        messageCount: 0,
                        senderName,
                        senderUsername
                    };
                    userSessions.set(senderId, sessionData);
                } else {
                    sessionData.senderName = senderName;
                    sessionData.senderUsername = senderUsername;
                }

                // بررسی سقف پیام‌ها در یک جلسه (برای جلوگیری از سوءاستفاده یا اسپم بی‌پایان)
                if (sessionData.messageCount >= 8) {
                    return; // بیشتر از ۸ رفت و برگشت سکوت کن تا خود پوریا ببیند
                }

                console.log(`📩 [پی‌وی شخصی] پیام جدید از ${senderName} (@${senderUsername || 'بدون_یوزرنیم'}): "${messageText}"`);

                const isFirstMessage = sessionData.history.length === 0;

                // اضافه کردن پیام کاربر به تاریخچه مکالمه
                sessionData.history.push({ role: 'user', content: messageText });
                sessionData.lastTime = now;
                sessionData.messageCount++;

                // اگر پیام اول مخاطب است، بلافاصله به پوریا اطلاع بده
                if (isFirstMessage && botInstance && process.env.TELEGRAM_OWNER_ID) {
                    const userDisplay = senderUsername ? `@${senderUsername}` : 'ندارد';
                    const initialAlert = `🔔 *پیام جدید در پی‌وی شما!*\n\n` +
                        `👤 *نام:* ${senderName}\n` +
                        `🆔 *آیدی عددی:* \`${senderId}\`\n` +
                        `🌐 *یوزرنیم:* ${userDisplay}\n` +
                        `💬 *متن پیام:* "${messageText}"\n\n` +
                        `⏳ _حسن با شوخ‌طبعی در حال چت با مخاطب است. پس از پایان گفتگو، خلاصه کامل برای شما ارسال می‌شود._`;
                    botInstance.telegram.sendMessage(process.env.TELEGRAM_OWNER_ID, initialAlert, { parse_mode: 'Markdown' }).catch(() => {});
                }

                const count = sessionData.messageCount;
                const isFirst = count === 1;

                // ساخت پرامپت هوشمند، شوخ‌طبع، زنده و واکنش‌گرا به متن کاربر
                const systemInstruction = `تو «حسن» هستی؛ دستیار و منشی شخصی پوریا در تلگرام.
شخصیت و لحن تو:
- فوق‌العاده باحال، شوخ‌طبع، خونگرم، حاضر‌جواب و رفیق‌باز (لوتی و تهرونی)، ولی در عین حال بسیار مودب و باهوش.
- اینجا پی‌وی تلگرام شخصی پوریاست. پوریا الان آنلاین نیست یا سرش شلوغه و تو داری به جایش چت می‌کنی.

اصول کلیدی که باید رعایت کنی:
۱. معرفی: ${isFirst ? 'چون پیام اول این مخاطب است، خیلی کوتاه و با شوخی خودت را معرفی کن (مثلاً: «سلام مخلصم! من حسنم، دستیار و منشی باحال پوریا. پوریا فعلاً سرش شلوغه ولی من در خدمتم، بفرما داداش چی شده؟»).' : 'چون مکالمه قبلاً شروع شده، به هیچ وجه دیگر سلام مجدد نده و خودت را معرفی نکن!'}
۲. پاسخ دقیق و مرتبط به حرف مخاطب: دقیقاً به همان سوال، حرف، شوخی یا درخواستی که مخاطب زده جواب بده! اگر حال پوریا را پرسید، اگر سوال فنی یا کاری پرسید، اگر احوالپرسی کرد، مستقیم متناسب با همان جواب بده. هرگز پاسخ‌های خشک، کلیشه‌ای یا رباتی از پیش تعیین‌شده نده.
۳. حس شوخ‌طبعی: بامزه باش، تیکه‌های صمیمی بنداز و حس یک گفتگوی زنده و باحال را منتقل کن.
۴. هدف‌سنجی و جمع‌بندی: ${count >= 4 ? 'چندین پیام رد و بدل شده؛ خیلی شوخ و خودمانی بگو اگر کار یا پیام دیگری هم با پوریا داری بگو تا یادداشت کنم، وگرنه منم جای دیگه دستم بنده و سرم شلوغه باید برم به بقیه کارام برسم!' : 'در حین چت متوجه شو چه کاری با پوریا دارد تا دقیق ثبت کنی.'}
۵. پاسخ‌ها کوتاه، روان و نهایتاً ۱ تا ۲ جمله باشد.`;

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
                        autoReply = `سلام مخلصم! من حسنم، دستیار باحال پوریا. پوریا فعلاً سرش شلوغه، بفرما داداش در خدمتم کاری داشتی بگو ثبت کنم بهش بگم.`;
                    } else if (count >= 4) {
                        autoReply = `حله رفیق، اگه کار دیگه‌ای هم با پوریا داری بگو تا یادداشت کنم، وگرنه منم باید برم سر کارم که سرم شلوغه! 🙏`;
                    } else {
                        autoReply = `حله گرفتم چی شد، نکته دیگه‌ای هم هست بهش بگم یا همینو به پوریا برسونم؟`;
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

                // اگر مکالمه به جمع‌بندی رسید (پیام ۴ به بعد)، زمان انتظار را کوتاه‌تر کن
                const summaryDelay = count >= 4 ? 45 * 1000 : 2 * 60 * 1000;

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

        // ذخیره خلاصه در دیتابیس
        try {
            contacts.updateSummary(senderId, summary.trim());
        } catch (e) {}

        const usernameText = sessionData.senderUsername ? `@${sessionData.senderUsername}` : 'ندارد';

        const reportMsg = `📋 *گزارش پایان گفتگو با مخاطب*\n\n` +
            `👤 *نام:* ${senderName}\n` +
            `🆔 *آیدی عددی (User ID):* \`${senderId}\`\n` +
            `🌐 *یوزرنیم:* ${usernameText}\n\n` +
            `🎯 *خلاصه گفتگو و خواسته مخاطب:*\n${summary.trim()}\n\n` +
            `💬 *تعداد تبادل پیام:* ${Math.ceil(sessionData.history.length / 2)}\n` +
            `🕒 *زمان اتمام:* ${new Date().toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran' })}`;

        await botInstance.telegram.sendMessage(process.env.TELEGRAM_OWNER_ID, reportMsg, { parse_mode: 'Markdown' });
        console.log(`✅ خلاصه گفتگوی منشی با ${senderName} همراه با آیدی و یوزرنیم برای پوریا ارسال شد.`);
    } catch (err) {
        console.error('❌ خطا در ارسال خلاصه گفتگو:', err.message);
    }
}

module.exports = { startUserbot };


