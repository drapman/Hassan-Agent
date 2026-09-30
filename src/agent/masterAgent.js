/**
 * Master AI Agent - هسته اصلی هوش مصنوعی
 * 
 * این فایل Agent اصلی رو با Gemini API می‌سازه
 * و تمام ابزارها رو بهش وصل می‌کنه
 */

require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const { conversations, memory, log } = require('../database/db');

// ──────────────────────────────────────────────────
// Import all tools
// ──────────────────────────────────────────────────
const siteTools = require('../tools/siteTools');
const emailTools = require('../tools/emailTools');
const webTools = require('../tools/webTools');

if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY یافت نشد! لطفاً فایل .env را تنظیم کنید.');
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ──────────────────────────────────────────────────
// Tool Definitions (تعریف ابزارها برای Gemini)
// ──────────────────────────────────────────────────
const toolDeclarations = [
    // ─── Site Tools ───
    {
        name: 'get_new_users',
        description: 'دریافت لیست کاربران جدید سایت. برای مشاهده کاربرانی که اخیراً ثبت‌نام کرده‌اند استفاده می‌شه.',
        parameters: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'تعداد کاربران (پیش‌فرض: 10)' },
                days: { type: 'number', description: 'محدوده زمانی به روز (پیش‌فرض: 7)' },
            },
        },
    },
    {
        name: 'search_user',
        description: 'جستجوی کاربر با نام، ایمیل یا آیدی در سایت.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'نام، ایمیل یا آیدی کاربر' },
            },
            required: ['query'],
        },
    },
    {
        name: 'get_user_progress',
        description: 'دریافت پیشرفت و فعالیت یک کاربر خاص در سایت.',
        parameters: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: 'آیدی کاربر' },
            },
            required: ['user_id'],
        },
    },
    {
        name: 'send_message_to_user',
        description: 'ارسال پیام مستقیم به یک کاربر سایت.',
        parameters: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: 'آیدی کاربر' },
                message: { type: 'string', description: 'متن پیام' },
                type: { type: 'string', description: 'نوع پیام: info, warning, success', enum: ['info', 'warning', 'success'] },
            },
            required: ['user_id', 'message'],
        },
    },
    {
        name: 'add_user_note',
        description: 'اضافه کردن یادداشت به پروفایل کاربر سایت.',
        parameters: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: 'آیدی کاربر' },
                note: { type: 'string', description: 'متن یادداشت' },
                tags: { type: 'array', items: { type: 'string' }, description: 'برچسب‌ها' },
            },
            required: ['user_id', 'note'],
        },
    },
    {
        name: 'get_site_stats',
        description: 'دریافت آمار کلی سایت شامل تعداد کاربران، ثبت‌نام‌های جدید و ...',
        parameters: { type: 'object', properties: {} },
    },

    // ─── Email Tools ───
    {
        name: 'get_emails',
        description: 'دریافت ایمیل‌های اخیر از صندوق پستی.',
        parameters: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'تعداد ایمیل (پیش‌فرض: 10)' },
                folder: { type: 'string', description: 'پوشه: INBOX, Sent, Spam (پیش‌فرض: INBOX)' },
                unread_only: { type: 'boolean', description: 'فقط خوانده‌نشده‌ها' },
            },
        },
    },
    {
        name: 'send_email',
        description: 'ارسال ایمیل.',
        parameters: {
            type: 'object',
            properties: {
                to: { type: 'string', description: 'آدرس گیرنده' },
                subject: { type: 'string', description: 'موضوع ایمیل' },
                body: { type: 'string', description: 'متن ایمیل' },
                is_html: { type: 'boolean', description: 'آیا HTML است؟' },
            },
            required: ['to', 'subject', 'body'],
        },
    },
    {
        name: 'search_emails',
        description: 'جستجو در ایمیل‌ها با کلمه کلیدی.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'کلمه کلیدی جستجو' },
            },
            required: ['query'],
        },
    },

    // ─── Web Tools ───
    {
        name: 'search_web',
        description: 'جستجو در اینترنت.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'عبارت جستجو' },
                max_results: { type: 'number', description: 'حداکثر نتایج' },
            },
            required: ['query'],
        },
    },
    {
        name: 'read_webpage',
        description: 'خواندن محتوای یک صفحه وب از URL.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'آدرس صفحه وب' },
            },
            required: ['url'],
        },
    },
    {
        name: 'track_iran_post',
        description: 'ردیابی مرسوله پستی با کد رهگیری پست ایران.',
        parameters: {
            type: 'object',
            properties: {
                tracking_code: { type: 'string', description: 'کد رهگیری پستی' },
            },
            required: ['tracking_code'],
        },
    },
    {
        name: 'get_currency_rates',
        description: 'دریافت نرخ ارز لحظه‌ای (دلار، یورو و ...).',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'search_flight_tickets',
        description: 'جستجوی بلیط هواپیما.',
        parameters: {
            type: 'object',
            properties: {
                origin: { type: 'string', description: 'شهر مبدا (مثال: Tehran یا THR)' },
                destination: { type: 'string', description: 'شهر مقصد (مثال: Mashhad یا MHD)' },
                date: { type: 'string', description: 'تاریخ پرواز (YYYY-MM-DD)' },
            },
            required: ['origin', 'destination', 'date'],
        },
    },
    {
        name: 'search_hotels',
        description: 'جستجوی هتل برای رزرو.',
        parameters: {
            type: 'object',
            properties: {
                city: { type: 'string', description: 'شهر' },
                check_in: { type: 'string', description: 'تاریخ ورود (YYYY-MM-DD)' },
                check_out: { type: 'string', description: 'تاریخ خروج (YYYY-MM-DD)' },
                guests: { type: 'number', description: 'تعداد مهمان' },
            },
            required: ['city', 'check_in', 'check_out'],
        },
    },

    // ─── Memory Tools ───
    {
        name: 'save_memory',
        description: 'ذخیره یک اطلاعات مهم برای استفاده در آینده.',
        parameters: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'نام کلید (شناسه یکتا)' },
                value: { type: 'string', description: 'مقدار یا اطلاعاتی که باید ذخیره بشه' },
                category: { type: 'string', description: 'دسته‌بندی: personal, work, reminders, contacts' },
            },
            required: ['key', 'value'],
        },
    },
    {
        name: 'recall_memory',
        description: 'بازیابی اطلاعات ذخیره‌شده قبلی.',
        parameters: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'نام کلید' },
            },
            required: ['key'],
        },
    },
];

// ──────────────────────────────────────────────────
// Tool Executor (اجرای ابزارها)
// ──────────────────────────────────────────────────
async function executeTool(toolName, args) {
    console.log(`🔧 اجرای ابزار: ${toolName}`, args);
    
    try {
        switch (toolName) {
            // Site Tools
            case 'get_new_users':
                return await siteTools.getNewUsers(args.limit, args.days);
            case 'search_user':
                return await siteTools.searchUser(args.query);
            case 'get_user_progress':
                return await siteTools.getUserProgress(args.user_id);
            case 'send_message_to_user':
                return await siteTools.sendMessageToUser(args.user_id, args.message, args.type);
            case 'add_user_note':
                return await siteTools.addUserNote(args.user_id, args.note, args.tags);
            case 'get_site_stats':
                return await siteTools.getSiteStats();

            // Email Tools
            case 'get_emails':
                return await emailTools.getEmails(args.limit, args.folder, args.unread_only);
            case 'send_email':
                return await emailTools.sendEmail(args.to, args.subject, args.body, args.is_html);
            case 'search_emails':
                return await emailTools.searchEmails(args.query);

            // Web Tools
            case 'search_web':
                return await webTools.searchWeb(args.query, args.max_results);
            case 'read_webpage':
                return await webTools.readWebPage(args.url);
            case 'track_iran_post':
                return await webTools.trackIranPost(args.tracking_code);
            case 'get_currency_rates':
                return await webTools.getCurrencyRates();
            case 'search_flight_tickets':
                return await webTools.searchFlightTickets(args.origin, args.destination, args.date);
            case 'search_hotels':
                return await webTools.searchHotels(args.city, args.check_in, args.check_out, args.guests);

            // Memory Tools
            case 'save_memory':
                memory.set.run(args.key, args.value, args.category || 'general');
                return { success: true, message: `✅ اطلاعات "${args.key}" ذخیره شد.` };
            case 'recall_memory':
                const result = memory.get.get(args.key);
                return result 
                    ? { success: true, key: args.key, value: result.value }
                    : { success: false, message: `اطلاعاتی با کلید "${args.key}" یافت نشد.` };

            default:
                return { success: false, error: `ابزار "${toolName}" شناخته نشده است.` };
        }
    } catch (error) {
        console.error(`❌ خطا در ابزار ${toolName}:`, error.message);
        return { success: false, error: error.message };
    }
}

// ──────────────────────────────────────────────────
// Main Agent Function
// ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `تو دستیار هوش مصنوعی شخصی من هستی با نام "Hassan Agent" (که صدات می‌زنیم "حسن" یا "حاج حسن").

🎭 شخصیت و لحن کلام (Personality & Tone):
• تو یک ربات خشک، رسمی و کتابی نیستی! تو رفیق شش‌دانگ، باهوش، بامزه، تیز و فوق‌العاده خودمونی منی.
• لحنت کاملاً صمیمی، محاوره‌ای، روان و دوستانه است (طوری که انگار سال‌هاست با هم رفیق شفیقیم).
• از ادبیات اداری و رسمی مثل «با سلام، کاربر گرامی»، «درخواست شما پردازش شد» و عبارات رباتیک شدیداً دوری کن! کلمات گرم و خودمونی به کار ببر مثل: «چاکریم»، «مخلصم رئیس»، «خیالت جمع»، «حلش کردم داداش»، «رو جفت چشمام».
• شوخ‌طبعی طبیعی و بجا داشته باش؛ تیکه‌های نمکین، خنده‌رویی، یا شوخی‌های ملایم دوستانه بزن تا فضا صمیمی و باحال باشه، ولی در عین حال کار رو با نهایت دقت و بدون سوتی انجام بده!

قابلیت‌های تو:
- مدیریت کاربران سایت: دیدن کاربران جدید، پیشرفت آنها، ارسال پیام
- بررسی ایمیل و ارسال ایمیل
- جستجو در اینترنت و خواندن صفحات وب
- ردیابی مرسولات پستی
- جستجوی بلیط هواپیما و هتل
- دریافت نرخ ارز و طلا
- پشتیبانی کامل از چت صوتی و پیام صوتی (شنیدن ویس‌های کاربر و پاسخ با Voice Note فارسی)
- ذخیره و بازیابی اطلاعات مهم (حافظه)

دستورالعمل‌ها:
1. همیشه به فارسی محاوره‌ای و روان پاسخ بده
2. اگر برای انجام کاری نیاز به ابزار داری، حتماً از آن استفاده کن
3. جستجو و پاسخگویی به اخبار و اطلاعات:
   • در صورت نیاز به بررسی وب، با یک جستجوی دقیق و سریع کار را جمع کن و از خواندن صفحات متعدد یا چرخه‌های طولانی خودداری کن مگر اینکه کاربر صراحتاً بررسی عمیق بخواهد.
   • تاریخ اخبار را در نظر بگیر و به شایعات بی‌اساس تکیه نکن.
4. پاسخ‌ها رو خلاصه، مفید، دقیق و خودمونی نگه دار (از پرگویی بی‌مورد بپرهیز)
5. اگر اطلاعاتی رو در حافظه ذخیره می‌کنی، به کاربر با لحن دوستانه اطلاع بده
6. در مورد اطلاعات حساس محتاط باش

تاریخ و زمان فعلی: ${new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })}`;

/**
 * پردازش پیام کاربر با Agent
 * @param {string} userMessage - پیام کاربر
 * @param {string} sessionId - شناسه سشن (برای حافظه)
 * @param {Function} onStatus - callback برای وضعیت (اختیاری)
 */
async function processMessage(userMessage, sessionId = 'default', onStatus = null) {
    try {
        // ذخیره پیام کاربر در تاریخچه
        conversations.save.run({
            session_id: sessionId,
            role: 'user',
            content: userMessage,
            platform: 'telegram',
        });

        // دریافت تاریخچه مکالمه (تنظیم روی حداکثر 4 پیام قبلی برای صرفه‌جویی شدید در مصرف توکن)
        // مقدار 5 خوانده می‌شود چون پیام جاری کاربر در دیتابیس ثبت شده و با slice(0, -1) دقیقاً 4 پیام قبلی باقی می‌ماند
        const history = conversations.getHistory.all(sessionId, 5);

        // ساختن context پیام‌ها با فرمت استاندارد
        const openAITools = toolDeclarations.map(t => ({ type: 'function', function: t }));
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT }
        ];

        // اضافه کردن تاریخچه (حداکثر 4 پیام اخیر)
        for (const msg of history.slice(0, -1)) {
            let content = msg.content || '';
            // جلوگیری از مصرف بیهوده توکن اگر پاسخ قبلی دستیار خیلی طولانی (مثل جدول یا لیست کاربران) بوده است
            if (msg.role === 'assistant' && content.length > 500) {
                content = content.substring(0, 500) + '... [خلاصه شد]';
            }
            messages.push({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: content
            });
        }

        // پیام فعلی کاربر
        messages.push({
            role: 'user',
            content: userMessage
        });

        const { askAI } = require('./aiRouter');

        // ─── حلقه اجرای Agent با Tool Calling ───
        let maxIterations = 3; // کاهش سقف چرخه به ۳ برای جلوگیری از مصرف تصاعدی توکن و خطای لیمیت
        let iterationCount = 0;
        let finalResponse = '';

        while (iterationCount < maxIterations) {
            iterationCount++;

            // درخواست از هوش مصنوعی با اولویت Groq -> OpenRouter -> Gemini
            const aiResult = await askAI({
                prompt: userMessage,
                systemInstruction: SYSTEM_PROMPT,
                messages,
                tools: openAITools
            });

            // اگر مدل دستور اجرای ابزار (Tool Call) صادر کرد
            if (aiResult && aiResult.tool_calls && aiResult.tool_calls.length > 0) {
                const toolNames = aiResult.tool_calls.map(tc => tc.function?.name).filter(Boolean).join(', ');
                if (onStatus && toolNames) {
                    await onStatus(`⏳ در حال اجرای: ${toolNames}...`);
                }

                messages.push({
                    role: 'assistant',
                    content: aiResult.text || null,
                    tool_calls: aiResult.tool_calls
                });

                for (const toolCall of aiResult.tool_calls) {
                    const funcName = toolCall.function?.name;
                    let args = {};
                    try {
                        args = typeof toolCall.function?.arguments === 'string'
                            ? JSON.parse(toolCall.function.arguments)
                            : (toolCall.function?.arguments || {});
                    } catch {
                        args = {};
                    }

                    const toolResult = await executeTool(funcName, args);
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
                    });
                }
            } else if (aiResult && aiResult.text) {
                finalResponse = aiResult.text;
                break;
            } else if (typeof aiResult === 'string') {
                finalResponse = aiResult;
                break;
            } else {
                break;
            }
        }

        if (!finalResponse) {
            finalResponse = 'متأسفانه در پردازش درخواست مشکلی پیش اومد.';
        }

        // ذخیره پاسخ Agent در تاریخچه
        conversations.save.run({
            session_id: sessionId,
            role: 'assistant',
            content: finalResponse,
            platform: 'telegram',
        });

        log.log.run('AGENT_RESPONSE', `سشن: ${sessionId}`, finalResponse.substring(0, 100), 1);
        return finalResponse;

    } catch (error) {
        console.error('❌ خطا در Agent:', error);
        const errorMsg = `❌ خطایی رخ داد: ${error.message}`;
        log.log.run('AGENT_ERROR', userMessage, error.message, 0);
        return errorMsg;
    }
}

/**
 * پاک کردن تاریخچه مکالمه یک سشن
 * @param {string} sessionId - شناسه سشن
 */
function clearSession(sessionId) {
    // حذف مکالمات این سشن
    const { db } = require('../database/db');
    db.prepare('DELETE FROM conversations WHERE session_id = ?').run(sessionId);
    return { success: true, message: `تاریخچه سشن ${sessionId} پاک شد.` };
}

module.exports = { processMessage, clearSession, toolDeclarations };
