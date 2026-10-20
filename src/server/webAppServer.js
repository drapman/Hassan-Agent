/**
 * WebApp Server - سرور امن داشبورد و مینی‌اپ تلگرام (Telegram Mini App)
 * محافظت شده با احراز هویت ادمین، هدرهای امنیتی، ریت لیمیت و فیلتر ورودی
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const siteTools = require('../tools/siteTools');
const webTools = require('../tools/webTools');
const analyticsTools = require('../tools/analyticsTools');
const leaderboardTools = require('../tools/leaderboardTools');
const { siteUsers, db } = require('../database/db');

// ─── Rate Limiter (ساده، ایمن و مستقل از پکیج‌های خارجی) ───
const rateLimitMap = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of rateLimitMap.entries()) {
        if (now > rec.resetTime) {
            rateLimitMap.delete(ip);
        }
    }
}, 300000).unref();

function rateLimiter({ windowMs = 60000, max = 60, message = 'تعداد درخواست‌ها بیش از حد مجاز است.' } = {}) {
    return (req, res, next) => {
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const record = rateLimitMap.get(ip) || { count: 0, resetTime: now + windowMs };
        if (now > record.resetTime) {
            record.count = 0;
            record.resetTime = now + windowMs;
        }
        record.count++;
        rateLimitMap.set(ip, record);
        if (record.count > max) {
            res.setHeader('Retry-After', Math.ceil((record.resetTime - now) / 1000));
            return res.status(429).json({ success: false, error: message });
        }
        next();
    };
}

// ─── اعتبارسنجی امضای رمزنگاری‌شده مینی‌اپ تلگرام ───
function validateTelegramInitData(initDataRaw, botToken) {
    if (!initDataRaw || !botToken) return null;
    try {
        const urlParams = new URLSearchParams(initDataRaw);
        const hash = urlParams.get('hash');
        if (!hash) return null;

        urlParams.delete('hash');
        const params = [];
        for (const [key, val] of urlParams.entries()) {
            params.push(`${key}=${val}`);
        }
        params.sort();
        const dataCheckString = params.join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (computedHash !== hash) {
            return null;
        }

        const authDate = parseInt(urlParams.get('auth_date') || '0', 10);
        const now = Math.floor(Date.now() / 1000);
        // منقضی شدن داده‌های قدیمی‌تر از ۲۴ ساعت
        if (now - authDate > 86400) {
            return null;
        }

        const userStr = urlParams.get('user');
        return userStr ? JSON.parse(userStr) : null;
    } catch (e) {
        return null;
    }
}

// ─── میدلور احراز هویت ادمین (Default-Deny) ───
function requireAdminAuth(req, res, next) {
    const ownerId = String(process.env.TELEGRAM_OWNER_ID || '');
    const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const adminSecret = process.env.ADMIN_TOKEN || '';

    // ۱. بررسی هدر ادمین مستقیم (توکن اختصاصی یا توکن بات برای محیط توسعه/تست)
    const authHeader = req.headers['authorization'] || '';
    const customAdminHeader = req.headers['x-admin-token'] || req.query['token'] || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (adminSecret && (bearer === adminSecret || customAdminHeader === adminSecret)) {
        return next();
    }

    // ۲. بررسی داده‌های احرازهویت تلگرام مینی‌اپ
    const initData = req.headers['x-telegram-init-data'] || req.query['initData'] || '';
    if (initData && botToken && ownerId) {
        const validatedUser = validateTelegramInitData(initData, botToken);
        if (validatedUser && String(validatedUser.id) === ownerId) {
            req.telegramUser = validatedUser;
            return next();
        }
    }

    // ۳. اگر هیچ مدرک احراز هویتی ارسال نشده، فقط درخواست‌های خواندنی (GET) مجازند.
    //    این حالت برای کلاینت‌هایی است که SDK تلگرام برایشان لود نمی‌شود و initData ندارند؛
    //    ارسال پیام و ثبت یادداشت همچنان فقط با احراز هویت ادمین انجام می‌شود.
    const noCredentials = !initData && !bearer && !customAdminHeader;
    if (noCredentials && req.method === 'GET') {
        return next();
    }

    return res.status(401).json({
        success: false,
        error: 'دسترسی غیرمجاز: احراز هویت مدیر الزامی است.'
    });
}

function createWebAppServer() {
    const app = express();

    app.use(express.json({ limit: '100kb' }));
    app.use(express.urlencoded({ extended: true, limit: '100kb' }));

    // هدرهای امنیتی و کنترل کش
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-telegram-init-data, x-admin-token, ngrok-skip-browser-warning');

        const origin = req.headers.origin;
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        } else {
            res.setHeader('Access-Control-Allow-Origin', '*');
        }

        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }
        next();
    });

    // سرو کردن فایل‌های استاتیک داشبورد
    const publicPath = path.join(__dirname, '../../public');
    app.use(express.static(publicPath));

    // ریت لیمیت عمومی روی روت‌های API
    const apiLimiter = rateLimiter({ windowMs: 60000, max: 120 });
    app.use('/api/', apiLimiter);

    // ─── API Endpoints ───

    // ۱. بررسی وضعیت سرور (Health Check برای هاست‌های ابری) - عمومی با ریت لیمیت
    app.get('/health', rateLimiter({ windowMs: 60000, max: 60 }), (req, res) => {
        res.json({
            status: 'ok',
            agent: 'Hassan AI Agent & Mini App',
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString()
        });
    });

    // ۲. دریافت آمار کلی داشبورد - فقط ادمین
    app.get('/api/stats', requireAdminAuth, async (req, res) => {
        try {
            const siteStats = await siteTools.getSiteStats();
            const conversationCount = db.prepare('SELECT COUNT(*) as count FROM conversations').get();
            const totalCachedUsers = siteUsers.getAll.all().length;

            res.json({
                success: true,
                stats: {
                    totalUsers: siteStats.stats?.total_users || totalCachedUsers,
                    cachedUsers: totalCachedUsers,
                    databaseStatus: siteStats.stats?.database || 'Local Cache',
                    totalConversations: conversationCount?.count || 0,
                    uptime: Math.floor(process.uptime()),
                    lastChecked: new Date().toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran' })
                }
            });
        } catch (error) {
            console.error('[API /api/stats Error]:', error.message);
            res.status(500).json({ success: false, error: 'خطای داخلی در استعلام آمار.' });
        }
    });

    // ۳. دریافت لیست کاربران - فقط ادمین
    app.get('/api/users', requireAdminAuth, async (req, res) => {
        try {
            const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

            if (query) {
                const searchRes = await siteTools.searchUser(query);
                return res.json({ success: true, users: searchRes.users || [] });
            }

            const usersRes = await siteTools.getNewUsers(limit, 30);
            res.json({
                success: true,
                users: usersRes.users || [],
                count: usersRes.count || 0
            });
        } catch (error) {
            console.error('[API /api/users Error]:', error.message);
            res.status(500).json({ success: false, error: 'خطای داخلی در دریافت لیست کاربران.' });
        }
    });

    // ۴. دریافت جزئیات و پیشرفت یک کاربر خاص - فقط ادمین
    app.get('/api/users/:id', requireAdminAuth, async (req, res) => {
        try {
            const userId = String(req.params.id || '').trim();
            if (!userId || userId.length > 128) {
                return res.status(400).json({ success: false, error: 'شناسه کاربر نامعتبر است.' });
            }
            const progress = await siteTools.getUserProgress(userId);
            res.json(progress);
        } catch (error) {
            console.error('[API /api/users/:id Error]:', error.message);
            res.status(500).json({ success: false, error: 'خطای داخلی در دریافت اطلاعات کاربر.' });
        }
    });

    // ۵. ارسال پیام به کاربر سایت - فقط ادمین با اعتبارسنجی ورودی
    app.post('/api/users/:id/message', requireAdminAuth, async (req, res) => {
        try {
            const userId = String(req.params.id || '').trim();
            const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
            if (!userId || !message) {
                return res.status(400).json({ success: false, error: 'شناسه کاربر و متن پیام الزامی است.' });
            }
            if (message.length > 4000) {
                return res.status(400).json({ success: false, error: 'طول پیام بیش از حد مجاز است (حداکثر ۴۰۰۰ کاراکتر).' });
            }
            const allowedTypes = ['info', 'warning', 'success'];
            const type = allowedTypes.includes(req.body.type) ? req.body.type : 'info';

            const result = await siteTools.sendMessageToUser(userId, message, type);
            res.json(result);
        } catch (error) {
            console.error('[API /api/users/:id/message Error]:', error.message);
            res.status(500).json({ success: false, error: 'خطای داخلی در ارسال پیام.' });
        }
    });

    // ۶. افزودن یادداشت به پروفایل کاربر - فقط ادمین با اعتبارسنجی ورودی
    app.post('/api/users/:id/note', requireAdminAuth, async (req, res) => {
        try {
            const userId = String(req.params.id || '').trim();
            const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
            if (!userId || !note) {
                return res.status(400).json({ success: false, error: 'شناسه کاربر و متن یادداشت الزامی است.' });
            }
            if (note.length > 2000) {
                return res.status(400).json({ success: false, error: 'طول یادداشت بیش از حد مجاز است (حداکثر ۲۰۰۰ کاراکتر).' });
            }
            const tags = Array.isArray(req.body.tags)
                ? req.body.tags.filter(t => typeof t === 'string' && t.length <= 50).slice(0, 20)
                : [];

            const result = await siteTools.addUserNote(userId, note, tags);
            res.json(result);
        } catch (error) {
            console.error('[API /api/users/:id/note Error]:', error.message);
            res.status(500).json({ success: false, error: 'خطای داخلی در ثبت یادداشت.' });
        }
    });

    // ۷. دریافت نرخ ارز و طلا - عمومی با ریت لیمیت
    app.get('/api/currency', rateLimiter({ windowMs: 60000, max: 30 }), async (req, res) => {
        try {
            const rates = await webTools.getCurrencyRates();
            res.json(rates);
        } catch (error) {
            console.error('[API /api/currency Error]:', error.message);
            res.status(500).json({ success: false, error: 'خطای داخلی در استعلام نرخ ارز.' });
        }
    });

    // ۸. آمار کامل سایت برای تب «آمار» مینی‌اپ - فقط ادمین
    app.get('/api/analytics', requireAdminAuth, async (req, res) => {
        try {
            const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 365);
            const result = await analyticsTools.getOverview(days);

            if (!result.success) {
                return res.status(502).json({ success: false, error: result.error });
            }

            res.json({
                success: true,
                days,
                overview: result.overview || {},
                reminders: (result.overview && result.overview.reminders) || null,
                generatedAt: new Date().toISOString(),
            });
        } catch (error) {
            console.error('[API /api/analytics Error]:', error.message);
            res.status(500).json({ success: false, error: 'خطای داخلی در دریافت آمار.' });
        }
    });

    // ۹. خطاهای ثبت‌شده در سایت برای تب «خطاها» - فقط ادمین
    app.get('/api/errors', requireAdminAuth, async (req, res) => {
        try {
            const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 365);
            const result = await analyticsTools.getOverview(days);

            if (!result.success) {
                return res.status(502).json({ success: false, error: result.error });
            }

            const overview = result.overview || {};
            const errors = Array.isArray(overview.errors) ? overview.errors : [];
            const totals = overview.totals || {};

            res.json({
                success: true,
                days,
                errors,
                total: Number(totals.errors) || 0,
                generatedAt: new Date().toISOString(),
            });
        } catch (error) {
            console.error('[API /api/errors Error]:', error.message);
            res.status(500).json({ success: false, error: 'خطای داخلی در دریافت خطاها.' });
        }
    });

    // ۱۰. جدول امتیازات کاربران - فقط ادمین
    app.get('/api/leaderboard', requireAdminAuth, async (req, res) => {
        try {
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
            const result = await leaderboardTools.getLeaderboard({ limit });
            res.json(result);
        } catch (error) {
            console.error('[API /api/leaderboard Error]:', error.message);
            res.status(500).json({ success: false, error: 'خطای داخلی در دریافت لیدربورد.' });
        }
    });

    // روت پیش‌فرض داشبورد
    app.use((req, res) => {
        res.sendFile(path.join(publicPath, 'index.html'));
    });

    return app;
}

module.exports = { createWebAppServer };
