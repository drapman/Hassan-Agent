/**
 * AI Router - مدیریت هوشمند و همزمان چند هوش مصنوعی (Groq, OpenRouter, Gemini)
 * با قابلیت جابجایی خودکار در صورت قطعی یا پر شدن ترافیک (Smart Fallback)
 */

const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

let geminiClient = null;
if (process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

/**
 * ارسال پیام به Groq (Llama 3.3 70B)
 */
async function callGroq(prompt, systemInstruction = '', messages = null) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY تنظیم نشده است');

    let formattedMessages = [];
    if (messages && Array.isArray(messages) && messages.length > 0) {
        formattedMessages = messages.map(m => ({
            role: m.role === 'model' ? 'assistant' : m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }));
        if (systemInstruction && !formattedMessages.some(m => m.role === 'system')) {
            formattedMessages.unshift({ role: 'system', content: systemInstruction });
        }
    } else {
        formattedMessages = [
            ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
            { role: 'user', content: prompt }
        ];
    }

    const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
    let lastErr = null;

    for (const model of models) {
        try {
            const response = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model,
                    messages: formattedMessages,
                    temperature: 0.7,
                    max_tokens: 2048,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey.trim()}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 20000,
                }
            );

            const text = response.data?.choices?.[0]?.message?.content?.trim();
            if (text) return { text, provider: `Groq (${model})` };
        } catch (err) {
            lastErr = err;
            console.warn(`Groq (${model}) error:`, err.response?.data?.error?.message || err.message);
        }
    }
    throw lastErr || new Error('خطا در ارتباط با Groq');
}

/**
 * ارسال پیام به OpenRouter (DeepSeek / Llama)
 */
async function callOpenRouter(prompt, systemInstruction = '', messages = null) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY تنظیم نشده است');

    let formattedMessages = [];
    if (messages && Array.isArray(messages) && messages.length > 0) {
        formattedMessages = messages.map(m => ({
            role: m.role === 'model' ? 'assistant' : m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }));
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
        'deepseek/deepseek-chat',
        'meta-llama/llama-3.3-70b-instruct:free',
        'google/gemini-2.0-flash-exp:free',
        'deepseek/deepseek-r1:free'
    ];
    let lastErr = null;

    for (const model of models) {
        try {
            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model,
                    messages: formattedMessages,
                    temperature: 0.7,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey.trim()}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://github.com/drapman/Hassan-Agent',
                        'X-Title': 'Hassan Agent',
                    },
                    timeout: 25000,
                }
            );

            const text = response.data?.choices?.[0]?.message?.content?.trim();
            if (text) return { text, provider: `OpenRouter (${model})` };
        } catch (err) {
            lastErr = err;
            console.warn(`OpenRouter (${model}) error:`, err.response?.data?.error?.message || err.message);
        }
    }
    throw lastErr || new Error('خطا در ارتباط با OpenRouter');
}

/**
 * ارسال پیام به Google Gemini
 */
async function callGemini(prompt, systemInstruction = '', messages = null) {
    if (!geminiClient) {
        if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY تنظیم نشده است');
        geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }

    const models = [
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.5-flash',
        'gemini-3.1-flash-lite',
        'gemini-flash-latest',
        'gemini-3.6-flash',
        'gemini-2.5-flash'
    ];
    let lastErr = null;

    let contents = prompt;
    let effectiveSystemInstruction = systemInstruction;

    if (messages && Array.isArray(messages) && messages.length > 0) {
        // جداسازی پیام‌های system و حفظ آنها در effectiveSystemInstruction
        const nonSystem = [];
        for (const m of messages) {
            if (m.role === 'system') {
                effectiveSystemInstruction = m.content || effectiveSystemInstruction;
            } else {
                nonSystem.push(m);
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
                contents[contents.length - 1].parts[0].text += '\n' + text;
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
            const response = await geminiClient.models.generateContent({
                model,
                contents,
                config: {
                    systemInstruction: effectiveSystemInstruction || undefined,
                    temperature: 0.7,
                },
            });

            const text = response.text?.trim();
            if (text) return { text, provider: `Gemini (${model})` };
        } catch (err) {
            lastErr = err;
            console.warn(`Gemini (${model}) error:`, err.message);
        }
    }
    throw lastErr || new Error('خطا در ارتباط با Gemini');
}

/**
 * تولید پاسخ هوشمند با سوییچ خودکار بین موتورها (Fallback هوشمند)
 * اولویت: Groq (سریع‌ترین) ➔ OpenRouter (تنوع بالا) ➔ Gemini (گوگل)
 */
async function askAI({ prompt = '', systemInstruction = '', messages = null }) {
    const providers = [];

    if (process.env.GROQ_API_KEY) {
        providers.push({ name: 'Groq', fn: () => callGroq(prompt, systemInstruction, messages) });
    }
    if (process.env.OPENROUTER_API_KEY) {
        providers.push({ name: 'OpenRouter', fn: () => callOpenRouter(prompt, systemInstruction, messages) });
    }
    if (process.env.GEMINI_API_KEY) {
        providers.push({ name: 'Gemini', fn: () => callGemini(prompt, systemInstruction, messages) });
    }

    // اگر هیچ کلیدی تنظیم نشده بود ولی جمینای کلید پیش‌فرض داشت
    if (providers.length === 0 && process.env.GEMINI_API_KEY) {
        providers.push({ name: 'Gemini', fn: () => callGemini(prompt, systemInstruction, messages) });
    }

    let lastError = null;

    for (const provider of providers) {
        try {
            const result = await provider.fn();
            if (result && result.text) {
                console.log(`🤖 پاسخ موفقیت‌آمیز از هوش مصنوعی: ${result.provider}`);
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
    callGroq,
    callOpenRouter,
    callGemini,
};
