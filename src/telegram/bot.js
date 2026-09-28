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

    await ctx.replyWithMarkdown(welcomeMsg,
        Markup.keyboard([
            ['📊 کاربران جدید', '📧 ایمیل‌ها'],
            ['💱 نرخ ارز', '✈️ بلیط'],
            ['🔄 شروع مجدد', '❓ راهنما'],
        ]).resize()
    );
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
// Keyboard Button Handlers
// ──────────────────────────────────────────────────
bot.hears('📊 کاربران جدید', async (ctx) => {
    await handleUserMessage(ctx, 'لیست کاربران جدید سایت رو در 7 روز گذشته نشون بده');
});

bot.hears('📧 ایمیل‌ها', async (ctx) => {
    await handleUserMessage(ctx, '10 تا ایمیل آخر رو نشون بده');
});

bot.hears('💱 نرخ ارز', async (ctx) => {
    await handleUserMessage(ctx, 'نرخ ارزها رو بهم بگو');
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
    if (processingUsers.has(userId)) {
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
        try {
            await ctx.sendChatAction(replyWithVoice ? 'record_voice' : 'typing');
            statusMessage = await ctx.reply('🤔 در حال بررسی...');
        } catch { /* ignore */ }

        try {
            // callback برای آپدیت وضعیت
            const onStatus = async (statusText) => {
                try {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        statusMessage?.message_id,
                        null,
                        statusText
                    );
                    await ctx.sendChatAction(replyWithVoice ? 'record_voice' : 'typing');
                } catch { /* ignore edit errors */ }
            };

            // پردازش با Agent
            const response = await processMessage(message, sessionId, onStatus);

            // حذف پیام وضعیت
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
