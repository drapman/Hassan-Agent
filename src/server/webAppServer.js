/**
 * WebApp Server - سرور داشبورد و مینی‌اپ تلگرام (Telegram Mini App)
 * ارائه فایل‌های رابط کاربری و API های پرسرعت مستقیم به دیتابیس بدون مصرف توکن
 */

const express = require('express');
const path = require('path');
const siteTools = require('../tools/siteTools');
const webTools = require('../tools/webTools');
const { siteUsers, db } = require('../database/db');

function createWebAppServer() {
    const app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // کش و هدرهای امنیتی
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, ngrok-skip-browser-warning');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('ngrok-skip-browser-warning', 'true');
        next();
    });

    // سرو کردن فایل‌های استاتیک داشبورد
    const publicPath = path.join(__dirname, '../../public');
    app.use(express.static(publicPath));

    // ─── API Endpoints ───

    // ۱. بررسی وضعیت سرور (Health Check برای هاست‌های ابری)
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            agent: 'Hassan AI Agent & Mini App',
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString()
        });
    });

    // ۲. دریافت آمار کلی داشبورد
    app.get('/api/stats', async (req, res) => {
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
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ۳. دریافت لیست کاربران (با پشتیبانی از سرچ)
    app.get('/api/users', async (req, res) => {
        try {
            const query = (req.query.q || '').trim();
            const limit = parseInt(req.query.limit) || 20;

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
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ۴. دریافت جزئیات و پیشرفت یک کاربر خاص
    app.get('/api/users/:id', async (req, res) => {
        try {
            const progress = await siteTools.getUserProgress(req.params.id);
            res.json(progress);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ۵. ارسال پیام به کاربر سایت
    app.post('/api/users/:id/message', async (req, res) => {
        try {
            const { message, type } = req.body;
            if (!message) {
                return res.status(400).json({ success: false, error: 'متن پیام الزامی است.' });
            }
            const result = await siteTools.sendMessageToUser(req.params.id, message, type || 'info');
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ۶. افزودن یادداشت به پروفایل کاربر
    app.post('/api/users/:id/note', async (req, res) => {
        try {
            const { note, tags } = req.body;
            if (!note) {
                return res.status(400).json({ success: false, error: 'متن یادداشت الزامی است.' });
            }
            const result = await siteTools.addUserNote(req.params.id, note, tags || []);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ۷. دریافت نرخ ارز و طلا
    app.get('/api/currency', async (req, res) => {
        try {
            const rates = await webTools.getCurrencyRates();
            res.json(rates);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // روت پیش‌فرض داشبورد (سازگار با Express 5)
    app.use((req, res) => {
        res.sendFile(path.join(publicPath, 'index.html'));
    });

    return app;
}

module.exports = { createWebAppServer };
