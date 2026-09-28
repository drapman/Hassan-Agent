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

    const formattedMessages = messages || [
        ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
        { role: 'user', content: prompt }
    ];

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

    const formattedMessages = messages || [
        ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
        { role: 'user', content: prompt }
    ];

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
        'gemini-2.5-flash',
        'gemini-3.6-flash',
        'gemini-3-flash-preview',
        'gemini-2.5-flash-preview',
        'gemini-flash-lite-latest'
    ];
    let lastErr = null;

    let contents = prompt;
    if (messages && Array.isArray(messages) && messages.length > 0) {
        contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
    }

    for (const model of models) {
        try {
            const response = await geminiClient.models.generateContent({
                model,
                contents,
                config: {
                    systemInstruction: systemInstruction || undefined,
                    temperature: 0.7,
                },
            });

            const text = response.text?.trim();
            if (text) return { text, provider: `Gemini (${model})` };
        } catch (err) {
            lastErr = err;
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
