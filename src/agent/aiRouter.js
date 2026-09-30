/**
 * AI Router - مدیریت هوشمند و همزمان چند هوش مصنوعی (Gemini, OpenRouter, Groq)
 * با اولویت‌بندی بهینه، پشتیبانی کامل از Tool Calling و سوییچ خودکار (Smart Fallback)
 */

require('dotenv').config();
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

let geminiClient = null;
if (process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

// وضعیت بلاک بودن Groq (برای جلوگیری از هدر رفتن وقت روی خطای ۴۰۳ تحریم)
let isGroqBlocked = false;

/**
 * ارسال پیام به Google Gemini با پشتیبانی کامل از ابزارها و مکالمه چند مرحله‌ای
 */
async function callGemini(prompt, systemInstruction = '', messages = null, tools = null) {
    if (!geminiClient) {
        if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY تنظیم نشده است');
        geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }

    const models = [
        'gemini-flash-lite-latest',
    ];
    let lastErr = null;

    // استخراج و تبدیل ابزارها برای Gemini
    let functionDeclarations = [];
    if (tools && Array.isArray(tools) && tools.length > 0) {
        functionDeclarations = tools.map(t => {
            const fn = t.function || t;
            return {
                name: fn.name,
                description: fn.description || '',
                parameters: fn.parameters || { type: 'object', properties: {} }
            };
        });
    }

    let contents = prompt;
    let effectiveSystemInstruction = systemInstruction;

    if (messages && Array.isArray(messages) && messages.length > 0) {
        const nonSystem = [];
        for (const m of messages) {
            if (m.role === 'system') {
                effectiveSystemInstruction = m.content || effectiveSystemInstruction;
            } else if (m.role === 'tool') {
                nonSystem.push({
                    role: 'user',
                    content: `[نتیجه اجرای ابزار ${m.tool_call_id || ''}]:\n${m.content || ''}`
                });
            } else {
                nonSystem.push({
                    role: m.role === 'assistant' ? 'assistant' : 'user',
                    content: m.content || (m.tool_calls ? `[درخواست اجرای ابزار: ${m.tool_calls.map(tc => tc.function?.name).join(', ')}]` : '')
                });
            }
        }

        // رعایت ساختار نوبتی user و model مورد نیاز Gemini
        contents = [];
        let lastRole = null;
        for (const m of nonSystem) {
            const role = m.role === 'assistant' ? 'model' : 'user';
            const text = (m.content || '').trim();
            if (!text) continue;

            if (role === lastRole) {
                contents[contents.length - 1].parts[0].text += '\n\n' + text;
            } else {
                contents.push({
                    role,
                    parts: [{ text }]
                });
                lastRole = role;
            }
        }

        if (contents.length > 0 && contents[0].role !== 'user') {
            contents.unshift({ role: 'user', parts: [{ text: 'سلام' }] });
        }
    }

    for (const model of models) {
        try {
            const config = {
                systemInstruction: effectiveSystemInstruction || undefined,
                temperature: 0.7,
                maxOutputTokens: 800, // سقف ۸۰۰ توکن خروجی برای جلوگیری از مصرف زیاد
            };
            if (functionDeclarations.length > 0) {
                config.tools = [{ functionDeclarations }];
            }

            const response = await geminiClient.models.generateContent({
                model,
                contents,
                config,
            });

            const hasFunctionCalls = response.functionCalls && response.functionCalls.length > 0;
            const text = response.text?.trim() || '';

            if (hasFunctionCalls) {
                return {
                    text: text,
                    tool_calls: response.functionCalls.map((fc, i) => ({
                        id: fc.id || `call_${Date.now()}_${i}`,
                        type: 'function',
                        function: {
                            name: fc.name,
                            arguments: typeof fc.args === 'string' ? fc.args : JSON.stringify(fc.args || {})
                        }
                    })),
                    provider: `Gemini (${model})`
                };
            }

            if (text) {
                return {
                    text,
                    tool_calls: null,
                    provider: `Gemini (${model})`
                };
            }
        } catch (err) {
            lastErr = err;
            console.warn(`Gemini (${model}) error:`, err.message);
        }
    }
    throw lastErr || new Error('خطا در ارتباط با Gemini');
}

/**
 * ارسال پیام به OpenRouter (DeepSeek / Llama)
 */
async function callOpenRouter(prompt, systemInstruction = '', messages = null, tools = null) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY تنظیم نشده است');

    let formattedMessages = [];
    if (messages && Array.isArray(messages) && messages.length > 0) {
        formattedMessages = messages.map(m => {
            const role = m.role === 'model' ? 'assistant' : m.role;
            const item = { role, content: m.content || '' };
            if (m.tool_calls) item.tool_calls = m.tool_calls;
            if (m.tool_call_id) item.tool_call_id = m.tool_call_id;
            return item;
        });
        if (systemInstruction && !formattedMessages.some(m => m.role === 'system')) {
            formattedMessages.unshift({ role: 'system', content: systemInstruction });
        }
    } else {
        formattedMessages = [
            ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
            { role: 'user', content: prompt }
        ];
    }

    const models = [
        'meta-llama/llama-3.3-70b-instruct:free',
        'deepseek/deepseek-chat',
        'google/gemini-2.0-flash-exp:free',
        'deepseek/deepseek-r1:free'
    ];
    let lastErr = null;

    for (const model of models) {
        try {
            const body = {
                model,
                messages: formattedMessages,
                temperature: 0.7,
                max_tokens: 800
            };
            if (tools && tools.length > 0) {
                body.tools = tools;
            }

            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                body,
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey.trim()}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://github.com/drapman/Hassan-Agent',
                        'X-Title': 'Hassan Agent',
                    },
                    timeout: 15000,
                }
            );

            const choice = response.data?.choices?.[0];
            const msg = choice?.message;
            if (msg && (msg.content?.trim() || (msg.tool_calls && msg.tool_calls.length > 0))) {
                return {
                    text: msg.content?.trim() || '',
                    tool_calls: msg.tool_calls || null,
                    rawMessage: msg,
                    provider: `OpenRouter (${model})`
                };
            }
        } catch (err) {
            lastErr = err;
            console.warn(`OpenRouter (${model}) error:`, err.response?.data?.error?.message || err.message);
        }
    }
    throw lastErr || new Error('خطا در ارتباط با OpenRouter');
}

/**
 * ارسال پیام به Groq (Llama 3.3 70B)
 */
async function callGroq(prompt, systemInstruction = '', messages = null, tools = null) {
    if (isGroqBlocked) throw new Error('Groq به دلیل محدودیت شبکه یا تحریم در دسترس نیست.');

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY تنظیم نشده است');

    let formattedMessages = [];
    if (messages && Array.isArray(messages) && messages.length > 0) {
        formattedMessages = messages.map(m => {
            const role = m.role === 'model' ? 'assistant' : m.role;
            const item = { role, content: m.content || '' };
            if (m.tool_calls) item.tool_calls = m.tool_calls;
            if (m.tool_call_id) item.tool_call_id = m.tool_call_id;
            return item;
        });
        if (systemInstruction && !formattedMessages.some(m => m.role === 'system')) {
            formattedMessages.unshift({ role: 'system', content: systemInstruction });
        }
    } else {
        formattedMessages = [
            ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
            { role: 'user', content: prompt }
        ];
    }

    const models = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];
    let lastErr = null;

    for (const model of models) {
        try {
            const body = {
                model,
                messages: formattedMessages,
                temperature: 0.7,
                max_tokens: 800,
            };
            if (tools && tools.length > 0) {
                body.tools = tools;
            }

            const response = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                body,
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey.trim()}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 6000,
                }
            );

            const choice = response.data?.choices?.[0];
            const msg = choice?.message;
            if (msg) {
                return {
                    text: msg.content?.trim() || '',
                    tool_calls: msg.tool_calls || null,
                    rawMessage: msg,
                    provider: `Groq (${model})`
                };
            }
        } catch (err) {
            lastErr = err;
            const status = err.response?.status;
            const errMsg = err.response?.data?.error?.message || err.message;
            console.warn(`Groq (${model}) error:`, errMsg);

            if (status === 403 || errMsg.includes('Access denied')) {
                isGroqBlocked = true;
                console.warn('⚠️ دسترسی به Groq به دلیل محدودیت کشور/تحریم مسدود است. Groq به صورت خودکار تا اجرای بعدی غیرفعال شد.');
                break;
            }
        }
    }
    throw lastErr || new Error('خطا در ارتباط با Groq');
}

/**
 * تولید پاسخ هوشمند با سوییچ خودکار بین موتورها (Fallback هوشمند)
 * اولویت: ۱. Gemini (گوگل - فوق‌العاده سریع و پایدار) ➔ ۲. OpenRouter (پشتیبان معتبر) ➔ ۳. Groq (در صورت دسترسی)
 */
async function askAI({ prompt = '', systemInstruction = '', messages = null, tools = null }) {
    const providers = [];

    // اولویت اول: Google Gemini (فوق‌العاده سریع، بدون محدودیت تحریمی روی این IP، پشتیبانی کامل ابزارها)
    if (process.env.GEMINI_API_KEY) {
        providers.push({ name: 'Gemini', fn: () => callGemini(prompt, systemInstruction, messages, tools) });
    }

    // اولویت دوم: OpenRouter (پشتیبان معتبر و عمومی)
    if (process.env.OPENROUTER_API_KEY) {
        providers.push({ name: 'OpenRouter', fn: () => callOpenRouter(prompt, systemInstruction, messages, tools) });
    }

    // اولویت سوم: Groq (اگر مسدود نباشد)
    if (process.env.GROQ_API_KEY && !isGroqBlocked) {
        providers.push({ name: 'Groq', fn: () => callGroq(prompt, systemInstruction, messages, tools) });
    }

    let lastError = null;

    for (const provider of providers) {
        try {
            const result = await provider.fn();
            if (result && (result.text || (result.tool_calls && result.tool_calls.length > 0))) {
                console.log(`🤖 پاسخ موفقیت‌آمیز از هوش مصنوعی: ${result.provider}`);
                if (tools && tools.length > 0) {
                    return result;
                }
                return result.text;
            }
        } catch (err) {
            lastError = err;
            console.warn(`⚠️ هوش مصنوعی ${provider.name} به مشکل خورد (${err.response?.status || err.message}). سوییچ به هوش مصنوعی بعدی...`);
        }
    }

    throw lastError || new Error('هیچ‌کدام از موتورهای هوش مصنوعی در دسترس نیستند.');
}

module.exports = {
    askAI,
    callGemini,
    callOpenRouter,
    callGroq,
};

