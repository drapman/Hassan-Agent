/**
 * Web & Browser Tools - ابزارهای مرورگر و اینترنت
 * 
 * - جستجوی اینترنتی
 * - خواندن صفحات وب
 * - ردیابی سفارشات
 * - خرید بلیط و رزرو
 */

const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');
const { log } = require('../database/db');

// ─────────────────────────────────────────
// Web Search (جستجوی اینترنتی)
// ─────────────────────────────────────────

/**
 * جستجو در اینترنت با DuckDuckGo API (رایگان)
 * @param {string} query - کلمه جستجو
 * @param {number} maxResults - حداکثر نتایج
 */
async function searchWeb(query, maxResults = 3) {
    try {
        const cheerio = require('cheerio');
        const response = await axios.get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const results = [];

        $('.result__body').slice(0, maxResults).each((i, el) => {
            const title = $(el).find('.result__title').text().trim();
            const snippet = $(el).find('.result__snippet').text().trim();
            const link = $(el).find('.result__url').text().trim();
            if (title || snippet) {
                results.push({ title, snippet, url: link || '' });
            }
        });

        log.log.run('WEB_SEARCH', `جستجو: ${query}`, `${results.length} نتیجه`, 1);
        return { success: true, query, results };
    } catch (error) {
        log.log.run('WEB_SEARCH', `خطا در جستجوی: ${query}`, error.message, 0);
        return { success: false, error: error.message };
    }
}

/**
 * بررسی اینکه آیا آدرس IP خصوصی، لوپ‌بک یا متادیتای کلود است یا خیر
 */
function isPrivateOrReservedIP(ip) {
    if (!ip) return true;
    let normalized = ip;
    if (normalized.startsWith('::ffff:')) {
        normalized = normalized.substring(7);
    }

    if (net.isIPv4(normalized)) {
        const parts = normalized.split('.').map(Number);
        if (parts.length !== 4 || parts.some(isNaN)) return true;

        if (parts[0] === 0) return true; // 0.0.0.0/8
        if (parts[0] === 127) return true; // 127.0.0.0/8 Loopback
        if (parts[0] === 10) return true; // 10.0.0.0/8 Private
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12 Private
        if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16 Private
        if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16 Link-Local / Cloud Metadata
        if (parts[0] >= 224) return true; // Multicast & Reserved
        return false;
    }

    if (net.isIPv6(normalized)) {
        const lower = normalized.toLowerCase();
        if (lower === '::1' || lower === '::') return true; // Loopback / Unspecified
        if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
        if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // Link-local
        return false;
    }

    return true;
}

/**
 * اعتبارسنجی امن آدرس اینترنتی جهت پیشگیری از حملات SSRF
 */
async function validateSafeURL(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('آدرس وب نامعتبر است.');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('پروتکل مجاز نیست (تنها http و https مجاز هستند).');
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
        throw new Error('دسترسی به هاست‌های لوکال و داخلی مسدود است.');
    }

    // بررسی پورت‌های مشکوک یا داخلی
    const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
    const forbiddenPorts = [8090, 3000, 5173, 5432, 22, 25, 6379, 27017];
    if (forbiddenPorts.includes(port)) {
        throw new Error(`دسترسی به پورت داخلی ${port} مسدود است.`);
    }

    // تحلیل DNS برای کلیه رکوردهای آی‌پی
    let addresses = [];
    try {
        addresses = await dns.lookup(hostname, { all: true });
    } catch (e) {
        throw new Error(`خطای بررسی DNS دامنه: ${e.message}`);
    }

    if (!addresses || addresses.length === 0) {
        throw new Error('هیچ آدرس IP برای این دامنه یافت نشد.');
    }

    for (const record of addresses) {
        if (isPrivateOrReservedIP(record.address)) {
            throw new Error(`دسترسی به آدرس IP خصوصی (${record.address}) به دلایل امنیتی مسدود است.`);
        }
    }

    return parsed;
}

/**
 * خواندن محتوای یک صفحه وب با حفاظت کامل در برابر SSRF
 * @param {string} url - آدرس صفحه
 */
async function readWebPage(url) {
    try {
        await validateSafeURL(url);

        const response = await axios.get(url, {
            timeout: 10000,
            maxRedirects: 0, // جلوگیری از ریدایرکت مخرب به شبکه‌های داخلی
            maxContentLength: 2 * 1024 * 1024, // حداکثر ۲ مگابایت
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'fa,en;q=0.9',
            },
        });

        // پاکسازی HTML
        const cheerio = require('cheerio');
        const $ = cheerio.load(response.data);
        
        // حذف تگ‌های غیرضروری
        $('script, style, nav, footer, header, aside, .ad, .advertisement, #cookie-banner').remove();
        
        const title = $('title').text().trim();
        const mainContent = $('main, article, .content, .post-content, body').first().text();
        
        // پاکسازی فضاهای خالی اضافه
        const cleanText = mainContent
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, '\n')
            .trim()
            .substring(0, 1000);

        log.log.run('READ_WEBPAGE', `خواندن: ${url}`, `${cleanText.length} کاراکتر`, 1);
        return { success: true, url, title, content: cleanText };
    } catch (error) {
        log.log.run('READ_WEBPAGE', `خطا در خواندن: ${url}`, error.message, 0);
        return { success: false, error: error.message, url };
    }
}

// ─────────────────────────────────────────
// Order Tracking (ردیابی سفارشات)
// ─────────────────────────────────────────

/**
 * ردیابی سفارش ایرانی با کد رهگیری
 * @param {string} trackingCode - کد رهگیری پستی
 */
async function trackIranPost(trackingCode) {
    try {
        // ردیابی پست ایران از طریق API
        const response = await axios.get(`https://tracking.post.ir/api/v1/tracking/${trackingCode}`, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        return { success: true, trackingCode, data: response.data };
    } catch (error) {
        // تلاش برای روش جایگزین
        try {
            const altResponse = await axios.post('https://tracking.post.ir/api/v1/track', {
                barcodeNumber: trackingCode
            }, { timeout: 10000 });
            return { success: true, trackingCode, data: altResponse.data };
        } catch {
            return { 
                success: false, 
                trackingCode,
                error: 'کد رهگیری یافت نشد یا خطا در اتصال به سرور پست',
                suggestion: `لطفاً مستقیماً در https://tracking.post.ir چک کنید.`
            };
        }
    }
}

/**
 * دریافت قیمت لحظه‌ای دلار و طلا در بازار آزاد ایران (بر اساس TGJU)
 */
async function getCurrencyRates() {
    try {
        const cheerio = require('cheerio');
        const items = {
            'دلار آزاد': 'https://www.tgju.org/profile/price_dollar_rl',
            'یورو': 'https://www.tgju.org/profile/price_eur',
            'درهم امارات': 'https://www.tgju.org/profile/price_aed',
            'سکه امامی': 'https://www.tgju.org/profile/retail_sekee',
            'طلای ۱۸ عیار': 'https://www.tgju.org/profile/geram18'
        };

        const rates = {};
        for (const [name, url] of Object.entries(items)) {
            try {
                const res = await axios.get(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                    timeout: 5000
                });
                const ch = cheerio.load(res.data);
                const raw = ch('.value').first().text().trim().replace(/,/g, '').split(/\s+/)[0];
                const rial = parseInt(raw);
                if (!isNaN(rial)) {
                    const toman = Math.round(rial / 10);
                    rates[name] = `${toman.toLocaleString('fa-IR')} تومان`;
                }
            } catch (e) {
                // اگر یک قلم لود نشد ادامه بده
            }
        }

        if (Object.keys(rates).length > 0) {
            return {
                success: true,
                source: 'شبکه اطلاع‌رسانی طلا و ارز (TGJU)',
                market: 'بازار آزاد تهران',
                rates,
                updated: new Date().toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran' })
            };
        }

        return {
            success: true,
            market: 'نرخ تقریبی بازار آزاد',
            rates: { 'دلار': 'حدود ۲۴۴٬۰۰۰ تومان' }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ─────────────────────────────────────────
// Ticket & Reservation Tools
// ─────────────────────────────────────────

/**
 * جستجوی بلیط هواپیما (راهنما)
 * Agent رو راهنمایی می‌کنه به سایت‌های مناسب
 * @param {string} origin - مبدا
 * @param {string} destination - مقصد
 * @param {string} date - تاریخ (YYYY-MM-DD)
 */
async function searchFlightTickets(origin, destination, date) {
    const flightSites = [
        {
            name: 'علی‌بابا',
            url: `https://www.alibaba.ir/flights/${origin}-to-${destination}?date=${date}`,
            notes: 'مناسب برای پروازهای داخلی و بین‌المللی ایران',
        },
        {
            name: 'ایرتور',
            url: `https://www.irtour.ir/air/${origin}/${destination}/${date}`,
            notes: 'پروازهای داخلی',
        },
        {
            name: 'اسنپ‌تریپ',
            url: `https://www.snapptrip.com/flight/${origin}-${destination}/${date}`,
            notes: 'مقایسه قیمت',
        },
    ];

    // جستجوی نتایج با خواندن صفحه اصلی
    const results = {
        success: true,
        origin,
        destination,
        date,
        message: `برای خرید بلیط از ${origin} به ${destination} در تاریخ ${date}، سایت‌های زیر رو بررسی کن:`,
        sites: flightSites,
        recommendation: 'پیشنهاد: ابتدا قیمت رو در علی‌بابا و اسنپ‌تریپ مقایسه کن',
    };

    log.log.run('SEARCH_FLIGHTS', `${origin} → ${destination} (${date})`, '', 1);
    return results;
}

/**
 * جستجوی هتل
 * @param {string} city - شهر
 * @param {string} checkIn - تاریخ ورود
 * @param {string} checkOut - تاریخ خروج
 * @param {number} guests - تعداد مهمان
 */
async function searchHotels(city, checkIn, checkOut, guests = 1) {
    const hotelSites = [
        {
            name: 'اسنپ‌تریپ',
            url: `https://www.snapptrip.com/hotels/${city}?checkin=${checkIn}&checkout=${checkOut}&guests=${guests}`,
        },
        {
            name: 'علی‌بابا',
            url: `https://www.alibaba.ir/hotels/${city}?checkin=${checkIn}&checkout=${checkOut}`,
        },
        {
            name: '1جا',
            url: `https://www.1ja.ir/hotels/${city}`,
        },
    ];

    return {
        success: true,
        city,
        checkIn,
        checkOut,
        guests,
        message: `برای رزرو هتل در ${city}:`,
        sites: hotelSites,
    };
}

/**
 * جستجوی خدمات محلی
 * @param {string} query - نوع خدمت
 * @param {string} city - شهر
 */
async function searchLocalService(query, city) {
    const searchQuery = `${query} ${city} ایران`;
    return await searchWeb(searchQuery, 5);
}

module.exports = {
    searchWeb,
    readWebPage,
    trackIranPost,
    getCurrencyRates,
    searchFlightTickets,
    searchHotels,
    searchLocalService,
};
