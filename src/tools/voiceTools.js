/**
 * Voice Tools - ابزارهای صوتی دوطرفه (تبدیل گفتار به متن و متن به گفتار)
 * Speech-to-Text: Groq Whisper / Gemini
 * Text-to-Speech: Microsoft Edge Neural TTS / Google TTS
 */

require('dotenv').config();
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

let geminiClient = null;
if (process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

/**
 * تبدیل گفتار به متن (شنیدن ویس مخاطب)
 * @param {Buffer} audioBuffer - بافر فایل صوتی
 * @param {string} mimeType - نوع فایل (پیش‌فرض: audio/ogg)
 * @returns {Promise<string>} متن پیاده‌سازی شده
 */
async function transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
    if (!audioBuffer || audioBuffer.length === 0) return '';

    let cleanMime = (mimeType || 'audio/ogg').split(';')[0].trim().toLowerCase();
    if (cleanMime === 'audio/opus') cleanMime = 'audio/ogg';

    // ۱. تلاش با Groq Whisper (فوق‌العاده سریع و دقیق در فارسی)
    if (process.env.GROQ_API_KEY) {
        try {
            console.log('🎙️ در حال پیاده‌سازی متن فایل صوتی با Groq Whisper...');
            const formData = new FormData();
            const blob = new Blob([audioBuffer], { type: cleanMime });
            formData.append('file', blob, 'voice.ogg');
            formData.append('model', 'whisper-large-v3-turbo');
            formData.append('language', 'fa');
            formData.append('response_format', 'json');

            const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY.trim()}`
                },
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                const text = data.text?.trim();
                if (text) {
                    console.log(`✅ متن ویس استخراج شد (Groq Whisper): "${text}"`);
                    return text;
                }
            } else {
                const errText = await response.text();
                console.warn('⚠️ خطای Groq Whisper:', errText);
            }
        } catch (groqErr) {
            console.warn('⚠️ خطای ارتباط با Groq Whisper:', groqErr.message);
        }
    }

    // ۲. فال‌بک با Google Gemini
    if (process.env.GEMINI_API_KEY) {
        try {
            console.log('🎙️ در حال پیاده‌سازی متن فایل صوتی با Google Gemini...');
            if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

            const response = await geminiClient.models.generateContent({
                model: 'gemini-3.8-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                inlineData: {
                                    mimeType: cleanMime,
                                    data: audioBuffer.toString('base64')
                                }
                            },
                            {
                                text: 'لطفاً صدای موجود در این فایل را دقیق و کلمه به کلمه به زبان فارسی پیاده‌سازی کن. فقط و فقط متن گفتار را بنویس و هیچ توضیح اضافه‌ای نده.'
                            }
                        ]
                    }
                ]
            });

            const text = response.text?.trim();
            if (text) {
                console.log(`✅ متن ویس استخراج شد (Gemini): "${text}"`);
                return text;
            }
        } catch (geminiErr) {
            console.warn('⚠️ خطای Gemini در استخراج متن صوت:', geminiErr.message);
        }
    }

    return '';
}

/**
 * تبدیل متن به گفتار (تولید ویس تلگرامی با صدای فارسی)
 * @param {string} text - متن برای خواندن
 * @returns {Promise<Buffer|null>} بافر فایل صوتی (MP3/OGG)
 */
async function textToSpeech(text) {
    if (!text || !text.trim()) return null;

    // تمیزکاری متن برای خوانش طبیعی‌تر (حذف ایموجی‌های اضافی و فرمت‌های مارک‌داون)
    const cleanText = text
        .replace(/[*_`#~]/g, '')
        .replace(/https?:\/\/\S+/g, 'لینک')
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
        .trim();

    if (!cleanText) return null;

    // ۱. تلاش با Microsoft Edge TTS (صدای فرید - مردانه، طبیعی، خاکی و باکیفیت)
    try {
        const { MsEdgeTTS, OUTPUT_FORMAT } = require('edge-tts-node');
        const tts = new MsEdgeTTS({});
        await tts.setMetadata('fa-IR-FaridNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

        const chunks = [];
        const readable = tts.toStream(cleanText);

        const audioBuffer = await new Promise((resolve, reject) => {
            readable.on('data', chunk => chunks.push(chunk));
            readable.on('end', () => resolve(Buffer.concat(chunks)));
            readable.on('error', err => reject(err));
            setTimeout(() => reject(new Error('TTS timeout')), 10000);
        });

        if (audioBuffer && audioBuffer.length > 500) {
            console.log(`🔊 ویس فارسی با موفقیت تولید شد (Edge FaridNeural - ${audioBuffer.length} بایت)`);
            return audioBuffer;
        }
    } catch (edgeErr) {
        console.warn('⚠️ خطای Edge TTS، استفاده از موتور کمکی...', edgeErr.message);
    }

    // ۲. فال‌بک با موتور صوتی گوگل (با fetch استاندارد)
    try {
        const shortText = cleanText.substring(0, 180);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(shortText)}&tl=fa&client=tw-ob`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        if (response.ok) {
            const arrayBuf = await response.arrayBuffer();
            if (arrayBuf.byteLength > 200) {
                const buf = Buffer.from(arrayBuf);
                console.log(`🔊 ویس فارسی با موتور گوگل تولید شد (${buf.length} بایت)`);
                return buf;
            }
        }
    } catch (googleTtsErr) {
        console.warn('⚠️ خطای موتور کمکی صوتی:', googleTtsErr.message);
    }

    return null;
}

module.exports = {
    transcribeAudio,
    textToSpeech
};
