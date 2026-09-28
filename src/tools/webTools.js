/**
 * Web & Browser Tools - ابزارهای مرورگر و اینترنت
 * 
 * - جستجوی اینترنتی
 * - خواندن صفحات وب
 * - ردیابی سفارشات
 * - خرید بلیط و رزرو
 */

const axios = require('axios');
const { log } = require('../database/db');

// ─────────────────────────────────────────
// Web Search (جستجوی اینترنتی)
// ─────────────────────────────────────────

/**
 * جستجو در اینترنت با DuckDuckGo API (رایگان)
 * @param {string} query - کلمه جستجو
 * @param {number} maxResults - حداکثر نتایج
 */
async function searchWeb(query, maxResults = 5) {
    try {
        // DuckDuckGo Instant Answer API (رایگان، بدون نیاز به Key)
        const response = await axios.get('https://api.duckduckgo.com/', {
            params: {
                q: query,
                format: 'json',
                no_redirect: 1,
                no_html: 1,
                skip_disambig: 1,
            },
            timeout: 10000,
            headers: { 'User-Agent': 'HassanAIAgent/1.0' }
        });

        const data = response.data;
        const results = [];

        // نتیجه اصلی
        if (data.AbstractText) {
            results.push({
                type: 'summary',
                title: data.Heading || query,
                snippet: data.AbstractText,
                url: data.AbstractURL || '',
            });
        }

        // نتایج مرتبط
        if (data.RelatedTopics) {
            data.RelatedTopics.slice(0, maxResults).forEach(topic => {
                if (topic.Text && topic.FirstURL) {
                    results.push({
                        type: 'result',
                        title: topic.Text.split(' - ')[0],
                        snippet: topic.Text,
                        url: topic.FirstURL,
                    });
                }
            });
        }

        log.log.run('WEB_SEARCH', `جستجو: ${query}`, `${results.length} نتیجه`, 1);
        return { success: true, query, results };
    } catch (error) {
        log.log.run('WEB_SEARCH', `خطا در جستجوی: ${query}`, error.message, 0);
        return { success: false, error: error.message };
    }
}

/**
 * خواندن محتوای یک صفحه وب
 * @param {string} url - آدرس صفحه
 */
async function readWebPage(url) {
    try {
        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
            .substring(0, 3000); // حداکثر 3000 کاراکتر

        log.log.run('READ_WEBPAGE', `خواندن: ${url}`, `${cleanText.length} کاراکتر`, 1);
        return { success: true, url, title, content: cleanText };
    } catch (error) {
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
 * دریافت قیمت لحظه‌ای دلار/ارز
 */
async function getCurrencyRates() {
    try {
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', {
            timeout: 5000
        });
        
        const data = response.data;
        return {
            success: true,
            base: 'USD',
            rates: {
                IRR: data.rates.IRR,
                EUR: data.rates.EUR,
                GBP: data.rates.GBP,
                AED: data.rates.AED,
                TRY: data.rates.TRY,
            },
            updated: data.date,
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
