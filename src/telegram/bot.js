/**
 * Telegram Bot - ربات تلگرام
 * 
 * این فایل رابط اصلی بین کاربر و Agent است.
 * از طریق تلگرام می‌تونی با Agent صحبت کنی،
 * دستور بدی و نتیجه رو ببینی.
 */

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { processMessage, clearSession } = require('../agent/masterAgent');
const { initializeDatabase, memory, log } = require('../database/db');

// ──────────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────────
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN یافت نشد!');
    process.exit(1);
}

const OWNER_ID = parseInt(process.env.TELEGRAM_OWNER_ID || '0');
if (!OWNER_ID) {
    console.error('⚠️  TELEGRAM_OWNER_ID تنظیم نشده! بات برای همه باز خواهد بود.');
}

// ──────────────────────────────────────────────────
// Bot Setup
// ──────────────────────────────────────────────────
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// صف پردازش ترتیبی پیام‌ها برای هر کاربر
const userQueues = new Map();

// ──────────────────────────────────────────────────
// Middleware: بررسی دسترسی
// ──────────────────────────────────────────────────
bot.use(async (ctx, next) => {
    const senderId = ctx.from?.id;
    const senderName = ctx.from?.username || ctx.from?.first_name || 'کاربر';
    const text = ctx.message?.text || ctx.updateType;
    console.log(`📩 پیام جدید از [${senderName}] (آیدی: ${senderId}): "${text}"`);

    if (OWNER_ID && senderId !== OWNER_ID) {
        console.warn(`⛔ دسترسی غیرمجاز! آیدی پیام‌دهنده (${senderId}) با مالک (${OWNER_ID}) متفاوت است.`);
        await ctx.reply(`❌ شما دسترسی به این ربات ندارید.\nآیدی عددی تلگرام شما: ${senderId}\nلطفاً این آیدی را در TELEGRAM_OWNER_ID فایل .env قرار دهید.`);
        return;
    }
    return next();
});

// ──────────────────────────────────────────────────
// Commands (دستورات)
// ──────────────────────────────────────────────────

// /start - شروع
bot.command('start', async (ctx) => {
    const welcomeMsg = `🤖 *سلام! من Hassan Agent هستم.*

یه دستیار هوش مصنوعی شخصی با قابلیت‌های گسترده:

📊 *مدیریت سایت:*
• کاربران جدید و پیشرفت آنها
• ارسال پیام به کاربران

📧 *ایمیل:*
• بررسی صندوق ورودی
• ارسال ایمیل

🌐 *اینترنت:*
• جستجوی وب
• ردیابی پستی
• جستجوی بلیط و هتل
• نرخ ارز

🧠 *حافظه:*
• ذخیره اطلاعات مهم
• به یادآوری در مکالمات بعدی

---
💬 *کافیه بنویسی چی می‌خوای!*

مثال‌ها:
• "کاربران جدید سایت رو نشونم بده"
• "ایمیل‌های خوانده‌نشده رو چک کن"
• "بلیط تهران به مشهد فردا جستجو کن"
• "نرخ دلار چنده؟"`;

    await ctx.replyWithMarkdown(welcomeMsg, getMainKeyboard());
});

// /help - راهنما
bot.command('help', async (ctx) => {
    const helpMsg = `📖 *راهنمای Hassan Agent*

*دستورات:*
/start - شروع/منوی اصلی
/help - این راهنما
/clear - پاک کردن تاریخچه مکالمه
/status - وضعیت سیستم
/memory - مشاهده حافظه ذخیره‌شده

*نکات:*
• فقط به فارسی یا انگلیسی بنویس
• می‌تونی مستقیم دستور بدی بدون نیاز به فرمت خاص
• Agent حافظه مکالمه‌ها رو نگه می‌داره

*مثال‌های دستورات:*
• "آمار سایت رو بده"
• "10 تا ایمیل آخر رو نشون بده"
• "کاربر با ایمیل example@gmail.com رو پیدا کن"
• "به کاربر شماره 5 پیام بده که اشتراکت تمدید شد"
• "نرخ دلار رو ذخیره کن"`;

    await ctx.replyWithMarkdown(helpMsg);
});

// /clear - پاک کردن تاریخچه
bot.command('clear', async (ctx) => {
    const sessionId = `telegram_${ctx.from.id}`;
    clearSession(sessionId);
    await ctx.reply('✅ تاریخچه مکالمه پاک شد. یه مکالمه جدید شروع می‌کنیم.');
});

// /status - وضعیت سیستم
bot.command('status', async (ctx) => {
    const { db } = require('../database/db');
    
    const conversationCount = db.prepare('SELECT COUNT(*) as count FROM conversations').get();
    const userCount = db.prepare('SELECT COUNT(*) as count FROM site_users').get();
    const actionCount = db.prepare('SELECT COUNT(*) as count FROM agent_actions').get();
    const lastAction = db.prepare('SELECT * FROM agent_actions ORDER BY created_at DESC LIMIT 1').get();

    const statusMsg = `📊 *وضعیت Hassan Agent*

🤖 *هوش مصنوعی:* آنلاین ✅
📝 *مکالمات ذخیره‌شده:* ${conversationCount?.count || 0}
👥 *کاربران سایت در کش:* ${userCount?.count || 0}
⚙️ *اقدامات انجام‌شده:* ${actionCount?.count || 0}
⏰ *آخرین فعالیت:* ${lastAction?.created_at ? new Date(lastAction.created_at).toLocaleString('fa-IR') : 'هنوز هیچ'}

*تنظیمات:*
• ایمیل: ${process.env.EMAIL_USER ? '✅ متصل' : '❌ تنظیم نشده'}
• سایت API: ${process.env.SITE_API_URL ? '✅ متصل' : '⚠️ تنظیم نشده'}`;

    await ctx.replyWithMarkdown(statusMsg);
});

// /memory - مشاهده حافظه
bot.command('memory', async (ctx) => {
    const { db } = require('../database/db');
    const memories = db.prepare('SELECT * FROM agent_memory ORDER BY updated_at DESC LIMIT 20').all();

    if (memories.length === 0) {
        await ctx.reply('📭 هیچ اطلاعاتی در حافظه ذخیره نشده.');
        return;
    }

    const memList = memories.map(m => `• *${m.key}* (${m.category}): ${m.value.substring(0, 50)}...`).join('\n');
    await ctx.replyWithMarkdown(`🧠 *حافظه Agent (${memories.length} مورد):*\n\n${memList}`);
});

// ──────────────────────────────────────────────────
// Keyboard Button Handlers (پاسخ مستقیم بدون مصرف توکن هوش مصنوعی)
// ──────────────────────────────────────────────────
bot.hears('📊 کاربران جدید', async (ctx) => {
    try {
        const { getNewUsers } = require('../tools/siteTools');
        await ctx.sendChatAction('typing');
        const res = await getNewUsers(5, 7);
        if (res.success && res.users && res.users.length > 0) {
            let msg = `👥 <b>کاربران جدید اخیر سایت (${res.users.length} نفر):</b>\n\n`;
            res.users.slice(0, 5).forEach((u, idx) => {
                const rawName = u.full_name || u.username || u.name || 'بدون نام';
                const name = String(rawName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const email = String(u.email || 'بدون ایمیل').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const xp = u.xp || 0;
                const songs = u.songs_completed || 0;
                msg += `${idx + 1}. <b>${name}</b>\n📧 <code>${email}</code>\n⚡ امتیاز: ${xp} XP | 🎵 آهنگ‌ها: ${songs}\n\n`;
            });
            const webAppUrl = process.env.WEBAPP_URL;
            if (webAppUrl && webAppUrl.startsWith('https://')) {
                await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
                    [Markup.button.webApp('📱 مشاهده جزئیات در داشبورد', webAppUrl)]
                ]));
            } else {
                await ctx.replyWithHTML(msg);
            }
        } else {
            await ctx.reply('ℹ️ کاربر جدیدی در ۷ روز گذشته یافت نشد یا دیتابیس در دسترس نیست.');
        }
    } catch (err) {
        console.error('Error in new users command:', err);
        await ctx.reply(`❌ خطا در دریافت کاربران: ${err.message}`);
    }
});

bot.hears('📧 ایمیل‌ها', async (ctx) => {
    try {
        const { getEmails } = require('../tools/emailTools');
        await ctx.sendChatAction('typing');
        const emailRes = await getEmails(5, 'INBOX', false);
        if (emailRes.success && emailRes.emails && emailRes.emails.length > 0) {
            let msg = `📬 *آخرین ایمیل‌های صندوق ورودی (${emailRes.emails.length} مورد):*\n\n`;
            emailRes.emails.slice(0, 5).forEach((em, idx) => {
                msg += `${idx + 1}. *از:* ${em.from}\n📌 *موضوع:* ${em.subject}\n\n`;
            });
            await ctx.replyWithMarkdown(msg);
        } else {
            await ctx.reply(emailRes.error ? `⚠️ خطا در اتصال به ایمیل: ${emailRes.error}` : '📭 ایمیلی یافت نشد.');
        }
    } catch (err) {
        await ctx.reply(`❌ خطا در بررسی ایمیل: ${err.message}`);
    }
});

bot.hears('💱 نرخ ارز', async (ctx) => {
    try {
        const { getCurrencyRates } = require('../tools/webTools');
        await ctx.sendChatAction('typing');
        const ratesResult = await getCurrencyRates();
        if (ratesResult.success && ratesResult.rates) {
            let msg = `💰 *نرخ لحظه‌ای ارز و طلا (${ratesResult.market || 'بازار آزاد'}):*\n\n`;
            for (const [k, v] of Object.entries(ratesResult.rates)) {
                msg += `• *${k}:* ${v}\n`;
            }
            msg += `\n🕒 بروزرسانی: ${ratesResult.updated || new Date().toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran' })}`;
            await ctx.replyWithMarkdown(msg);
        } else {
            await ctx.reply('⚠️ متأسفانه در حال حاضر امکان دریافت قیمت‌های لحظه‌ای میسر نشد.');
        }
    } catch (err) {
        await ctx.reply(`❌ خطا در دریافت نرخ ارز: ${err.message}`);
    }
});

bot.hears('✈️ بلیط', async (ctx) => {
    await ctx.reply('✈️ برای جستجوی بلیط بنویس:\n"بلیط [مبدا] به [مقصد] برای [تاریخ]"\n\nمثال: بلیط تهران به مشهد برای 1403/8/15');
});

bot.hears('🔄 شروع مجدد', async (ctx) => {
    const sessionId = `telegram_${ctx.from.id}`;
    clearSession(sessionId);
    await ctx.reply('✅ مکالمه ریست شد!');
});

bot.hears('❓ راهنما', async (ctx) => {
    ctx.reply('راهنما', { reply_markup: { remove_keyboard: true } });
    await bot.telegram.sendMessage(ctx.chat.id, '/help');
});

// هندلر باز کردن داشبورد مدیریت و مینی‌اپ
bot.hears('📱 داشبورد مدیریت', async (ctx) => {
    await sendDashboardLink(ctx);
});

bot.command(['dashboard', 'app', 'panel'], async (ctx) => {
    await sendDashboardLink(ctx);
});

function getMainKeyboard() {
    const webAppUrl = process.env.WEBAPP_URL;
    const rows = [];
    if (webAppUrl && webAppUrl.startsWith('https://')) {
        rows.push([Markup.button.webApp('📱 داشبورد مدیریت', webAppUrl)]);
    } else {
        rows.push(['📱 داشبورد مدیریت']);
    }
    rows.push(['📊 کاربران جدید', '📧 ایمیل‌ها']);
    rows.push(['💱 نرخ ارز', '✈️ بلیط']);
    rows.push(['🔄 شروع مجدد', '❓ راهنما']);
    return Markup.keyboard(rows).resize();
}

async function sendDashboardLink(ctx) {
    const webAppUrl = process.env.WEBAPP_URL;
    if (webAppUrl && webAppUrl.startsWith('https://')) {
        await ctx.reply(
            '📱 *داشبورد مینی‌اپ تلگرام Hassan Agent*\n\nبرای دسترسی به پنل مدیریت کاربران، آمار زنده دیتابیس و نرخ ارز با مصرف صفر توکن، دکمه زیر را لمس کنید:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.webApp('🚀 باز کردن داشبورد مدیریت', webAppUrl)]
                ])
            }
        );
    } else {
        const localPort = process.env.PORT || 3000;
        await ctx.reply(
            `📱 *داشبورد مدیریت آماده است!*\n\n` +
            `🌐 *آدرس مرورگر محلی:* http://localhost:${localPort}\n\n` +
            `ℹ️ *نکته جهت باز شدن مستقیم داخل تلگرام:*\n` +
            `تلگرام برای Mini App نیاز به لینک امن (\`https://\`) دارد. اگر ربات را روی سرور ابری (مثل Render، Railway یا Koyeb) اجرا کرده‌اید یا از تونل استفاده می‌کنید، کافیست آدرس آن را در متغیر \`WEBAPP_URL\` فایل \`.env\` قرار دهید.\n\n` +
            `هم‌اکنون می‌توانید از طریق مرورگر مستقیماً وارد آدرس محلی شوید!`,
            { parse_mode: 'Markdown' }
        );
    }
}

// ──────────────────────────────────────────────────
// Main Message Handlers
// ──────────────────────────────────────────────────
const { transcribeAudio, textToSpeech } = require('../tools/voiceTools');
const axios = require('axios');

bot.on('text', async (ctx) => {
    const text = ctx.message.text || '';
    const wantsVoice = /ویس|صوتی|بخون|بگو|voice/i.test(text);
    await handleUserMessage(ctx, text, wantsVoice);
});

// هندلر صدا و پیام ویدیویی (شنیدن ویس کاربر و پاسخ صوتی دوطرفه)
bot.on(['voice', 'audio', 'video_note'], async (ctx) => {
    const userId = ctx.from.id;
    if (userQueues.has(userId)) {
        await ctx.reply('⏳ صبر کن، هنوز دارم روی پیام قبلیت کار می‌کنم...');
        return;
    }

    try {
        const voice = ctx.message.voice || ctx.message.audio || ctx.message.video_note;
        if (!voice) return;

        await ctx.sendChatAction('record_voice');
        const fileLink = await ctx.telegram.getFileLink(voice.file_id);
        const res = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        const audioBuffer = Buffer.from(res.data);

        const transcribedText = await transcribeAudio(audioBuffer, voice.mime_type || 'audio/ogg');
        if (!transcribedText) {
            await ctx.reply('🎤 متأسفانه نتونستم صدای ویس رو واضح بشنوم، بی زحمت دوباره بفرست یا تایپ کن.');
            return;
        }

        console.log(`🎙️ ویس دریافتی از ${ctx.from.first_name}: "${transcribedText}"`);
        await ctx.reply(`🎙️ *متن ویس شما:* "${transcribedText}"`, { parse_mode: 'Markdown' });

        await handleUserMessage(ctx, transcribedText, true);
    } catch (err) {
        console.error('❌ خطا در پردازش ویس کاربر:', err);
        await ctx.reply('❌ در پردازش فایل صوتی مشکلی پیش آمد.');
    }
});

// هندلر عکس
bot.on('photo', async (ctx) => {
    await ctx.reply('🖼️ متأسفانه در حال حاضر پردازش عکس پشتیبانی نمی‌شه.');
});

// ──────────────────────────────────────────────────
// Core Handler Function
// ──────────────────────────────────────────────────
async function handleUserMessage(ctx, message, replyWithVoice = false) {
    const userId = ctx.from.id;
    const prevQueue = userQueues.get(userId) || Promise.resolve();

    const currentOperation = async () => {
        const sessionId = `telegram_${userId}`;
        let statusMessage = null;
        let statusTimer = setTimeout(async () => {
            try {
                statusMessage = await ctx.reply('🤔 در حال بررسی...');
            } catch { /* ignore */ }
        }, 2000);

        try {
            await ctx.sendChatAction(replyWithVoice ? 'record_voice' : 'typing');
        } catch { /* ignore */ }

        try {
            // callback برای آپدیت وضعیت
            const onStatus = async (statusText) => {
                try {
                    if (!statusMessage) {
                        clearTimeout(statusTimer);
                        statusMessage = await ctx.reply(statusText);
                    } else {
                        await ctx.telegram.editMessageText(
                            ctx.chat.id,
                            statusMessage.message_id,
                            null,
                            statusText
                        );
                    }
                    await ctx.sendChatAction(replyWithVoice ? 'record_voice' : 'typing');
                } catch { /* ignore edit errors */ }
            };

            // پردازش با Agent
            const response = await processMessage(message, sessionId, onStatus);

            clearTimeout(statusTimer);

            // حذف پیام وضعیت در صورت وجود
            if (statusMessage) {
                try {
                    await ctx.telegram.deleteMessage(ctx.chat.id, statusMessage.message_id);
                } catch { /* ignore */ }
            }

            // اگر کاربر ویس فرستاده بود، پاسخ صوتی هم برایش بساز و بفرست
            if (replyWithVoice) {
                try {
                    await ctx.sendChatAction('record_voice');
                    const voiceBuffer = await textToSpeech(response);
                    if (voiceBuffer) {
                        await ctx.replyWithVoice(
                            { source: voiceBuffer },
                            { caption: response.substring(0, 1024) }
                        );
                        return;
                    }
                } catch (ttsErr) {
                    console.warn('⚠️ ارسال ویس با مشکل مواجه شد، ارسال متن:', ttsErr.message);
                }
            }

            // ارسال پاسخ متنی (با مدیریت حد کاراکتر تلگرام)
            if (response.length <= 4096) {
                await ctx.replyWithMarkdown(response).catch(() => ctx.reply(response));
            } else {
                // تقسیم پیام طولانی
                const chunks = response.match(/.{1,4000}/gs) || [];
                for (const chunk of chunks) {
                    await ctx.replyWithMarkdown(chunk).catch(() => ctx.reply(chunk));
                }
            }

        } catch (error) {
            clearTimeout(statusTimer);
            console.error('❌ خطا در handleUserMessage:', error);
            
            if (statusMessage) {
                try {
                    await ctx.telegram.deleteMessage(ctx.chat.id, statusMessage.message_id);
                } catch { /* ignore */ }
            }
            
            await ctx.reply(`❌ خطایی رخ داد: ${error.message}\nلطفاً دوباره امتحان کن.`);
        }
    };

    const nextQueue = prevQueue
        .then(currentOperation)
        .catch(err => console.error('❌ خطا در صف پردازش پیام:', err))
        .finally(() => {
            if (userQueues.get(userId) === nextQueue) {
                userQueues.delete(userId);
            }
        });

    userQueues.set(userId, nextQueue);
    return nextQueue;
}

// ──────────────────────────────────────────────────
// Error Handler
// ──────────────────────────────────────────────────
bot.catch((err, ctx) => {
    console.error(`❌ خطای بات برای ${ctx.updateType}:`, err);
    log.log.run('BOT_ERROR', ctx.updateType, err.message, 0);
});

// ──────────────────────────────────────────────────
// Start Bot
// ──────────────────────────────────────────────────
async function startBot() {
    console.log('🚀 در حال راه‌اندازی Hassan Agent...');
    
    // اولیه‌سازی دیتابیس
    initializeDatabase();
    
    const botInfo = await bot.telegram.getMe();
    console.log(`✅ Hassan Agent فعال شد!`);
    console.log(`🤖 نام بات: @${botInfo.username}`);
    console.log(`🔗 لینک: https://t.me/${botInfo.username}`);
    console.log(`👤 مالک: ${OWNER_ID || 'همه (تنظیم نشده)'}`);

    // راه‌اندازی دریافت پیام‌ها (Polling)
    console.log('📡 ربات آماده دریافت پیام است...');
    bot.launch({ dropPendingUpdates: false }).catch(err => {
        console.error('❌ خطای غیرمنتظره در bot.launch:', err);
    });
    
    // Graceful shutdown
    process.once('SIGINT', () => {
        console.log('\n🛑 در حال خاموش کردن...');
        bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { startBot, bot };
