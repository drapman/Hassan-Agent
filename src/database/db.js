/**
 * Database Manager - SQLite for local persistent storage
 * ذخیره حافظه مکالمات، کاربران و تاریخچه
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/agent.db';

// اطمینان از وجود پوشه
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Performance optimizations
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

/**
 * ایجاد جداول اولیه
 * توجه: این تابع فوری هنگام بارگذاری ماژول اجرا می‌شه
 * تا جداول قبل از db.prepare() وجود داشته باشن
 */
function initializeDatabase() {
    // جدول تاریخچه مکالمات با Agent
    db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL,
            platform TEXT DEFAULT 'telegram',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
        CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);
    `);

    // جدول کاربران سایت (کش محلی)
    db.exec(`
        CREATE TABLE IF NOT EXISTS site_users (
            id INTEGER PRIMARY KEY,
            site_user_id TEXT UNIQUE NOT NULL,
            username TEXT,
            email TEXT,
            full_name TEXT,
            registration_date DATETIME,
            last_activity DATETIME,
            progress_data TEXT DEFAULT '{}',
            notes TEXT DEFAULT '',
            tags TEXT DEFAULT '[]',
            synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_site_users_id ON site_users(site_user_id);
        CREATE INDEX IF NOT EXISTS idx_site_users_email ON site_users(email);
    `);

    // جدول لاگ اقدامات Agent
    db.exec(`
        CREATE TABLE IF NOT EXISTS agent_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_type TEXT NOT NULL,
            description TEXT,
            result TEXT,
            success INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // جدول یادداشت‌ها و اطلاعات مهم Agent
    db.exec(`
        CREATE TABLE IF NOT EXISTS agent_memory (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // جدول سفارشات (برای ردیابی)
    db.exec(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT UNIQUE,
            platform TEXT NOT NULL,
            status TEXT,
            items TEXT DEFAULT '[]',
            total_price TEXT,
            order_date DATETIME,
            expected_delivery DATETIME,
            tracking_code TEXT,
            details TEXT DEFAULT '{}',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    console.log('✅ Database initialized successfully');
}

// ─── اجرای فوری هنگام بارگذاری ماژول ───
// باید قبل از هر db.prepare() اجرا بشه!
initializeDatabase();

// ─────────────────────────────────────────
// Conversation History Functions
// ─────────────────────────────────────────

const conversationOps = {
    /**
     * ذخیره پیام جدید در تاریخچه مکالمه
     */
    save: db.prepare(`
        INSERT INTO conversations (session_id, role, content, platform)
        VALUES (@session_id, @role, @content, @platform)
    `),

    /**
     * دریافت تاریخچه مکالمه (آخرین N پیام)
     */
    getHistory: db.prepare(`
        SELECT role, content, created_at 
        FROM conversations 
        WHERE session_id = ?
        ORDER BY created_at ASC
        LIMIT ?
    `),

    /**
     * دریافت تمام سشن‌های فعال
     */
    getSessions: db.prepare(`
        SELECT DISTINCT session_id, MAX(created_at) as last_active, COUNT(*) as message_count
        FROM conversations
        GROUP BY session_id
        ORDER BY last_active DESC
        LIMIT 20
    `),

    /**
     * پاک کردن تاریخچه قدیمی (بیشتر از 30 روز)
     */
    cleanOld: db.prepare(`
        DELETE FROM conversations 
        WHERE created_at < datetime('now', '-30 days')
    `)
};

// ─────────────────────────────────────────
// Site Users Functions
// ─────────────────────────────────────────

const siteUserOps = {
    upsert: db.prepare(`
        INSERT OR REPLACE INTO site_users 
        (site_user_id, username, email, full_name, registration_date, last_activity, progress_data, synced_at)
        VALUES (@site_user_id, @username, @email, @full_name, @registration_date, @last_activity, @progress_data, CURRENT_TIMESTAMP)
    `),

    getById: db.prepare(`SELECT * FROM site_users WHERE site_user_id = ?`),
    
    getByEmail: db.prepare(`SELECT * FROM site_users WHERE email LIKE ?`),

    getRecent: db.prepare(`
        SELECT * FROM site_users 
        ORDER BY registration_date DESC 
        LIMIT ?
    `),

    search: db.prepare(`
        SELECT * FROM site_users 
        WHERE username LIKE ? OR email LIKE ? OR full_name LIKE ?
        LIMIT 10
    `),

    addNote: db.prepare(`
        UPDATE site_users SET notes = ?, tags = ? WHERE site_user_id = ?
    `),

    getAll: db.prepare(`SELECT * FROM site_users ORDER BY registration_date DESC`),
};

// ─────────────────────────────────────────
// Agent Memory Functions  
// ─────────────────────────────────────────

const memoryOps = {
    set: db.prepare(`
        INSERT OR REPLACE INTO agent_memory (key, value, category, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `),

    get: db.prepare(`SELECT value FROM agent_memory WHERE key = ?`),

    getByCategory: db.prepare(`
        SELECT key, value FROM agent_memory WHERE category = ?
    `),

    delete: db.prepare(`DELETE FROM agent_memory WHERE key = ?`),
};

// ─────────────────────────────────────────
// Orders Functions
// ─────────────────────────────────────────

const orderOps = {
    upsert: db.prepare(`
        INSERT OR REPLACE INTO orders 
        (order_id, platform, status, items, total_price, order_date, expected_delivery, tracking_code, details, updated_at)
        VALUES (@order_id, @platform, @status, @items, @total_price, @order_date, @expected_delivery, @tracking_code, @details, CURRENT_TIMESTAMP)
    `),

    getAll: db.prepare(`SELECT * FROM orders ORDER BY order_date DESC`),
    
    getByStatus: db.prepare(`SELECT * FROM orders WHERE status = ? ORDER BY order_date DESC`),

    getById: db.prepare(`SELECT * FROM orders WHERE order_id = ?`),
};

// ─────────────────────────────────────────
// Action Logging
// ─────────────────────────────────────────

const logOps = {
    log: db.prepare(`
        INSERT INTO agent_actions (action_type, description, result, success)
        VALUES (?, ?, ?, ?)
    `),

    getRecent: db.prepare(`
        SELECT * FROM agent_actions 
        ORDER BY created_at DESC 
        LIMIT ?
    `)
};

module.exports = {
    db,
    initializeDatabase,
    conversations: conversationOps,
    siteUsers: siteUserOps,
    memory: memoryOps,
    orders: orderOps,
    log: logOps,
};
