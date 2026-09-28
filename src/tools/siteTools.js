/**
 * Site Users Tool - ابزارهای مدیریت کاربران سایت
 * 
 * پشتیبانی مستقیم و نیتیو از Supabase + REST API
 */

const axios = require('axios');
const { siteUsers, log } = require('../database/db');

const SITE_API_URL = process.env.SITE_API_URL || '';
const SITE_API_KEY = process.env.SITE_API_KEY || '';

// تنظیم کلاینت Supabase در صورت وجود
let supabase = null;
if (SITE_API_URL && SITE_API_KEY && SITE_API_URL.includes('supabase.co')) {
    try {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(SITE_API_URL, SITE_API_KEY);
        console.log('⚡ اتصال به دیتابیس Supabase با موفقیت برقرار شد.');
    } catch (e) {
        console.warn('⚠️ خطا در ایجاد کلاینت Supabase:', e.message);
    }
}

// کلاینت پیش‌فرض برای REST API معمولی
const siteApiClient = axios.create({
    baseURL: SITE_API_URL,
    headers: {
        'Authorization': `Bearer ${SITE_API_KEY}`,
        'apikey': SITE_API_KEY,
        'Content-Type': 'application/json'
    },
    timeout: 10000
});

/**
 * همگام‌سازی کاربران با کش محلی SQLite
 */
function syncUsersToCache(users) {
    if (!Array.isArray(users)) return;
    users.forEach(user => {
        try {
            siteUsers.upsert.run({
                site_user_id: String(user.id || user._id || user.user_id),
                username: user.username || user.name || user.email || '',
                email: user.email || '',
                full_name: user.full_name || user.name || user.display_name || '',
                registration_date: user.created_at || user.registration_date || new Date().toISOString(),
                last_activity: user.last_activity || user.updated_at || user.last_login || null,
                progress_data: JSON.stringify(user.progress || user.data || {}),
            });
        } catch (e) {
            // نادیده گرفتن خطای ثبت تکی
        }
    });
}

/**
 * دریافت لیست کاربران جدید سایت
 * @param {number} limit - تعداد کاربران
 * @param {number} days - محدوده زمانی (روز)
 */
async function getNewUsers(limit = 10, days = 7) {
    try {
        let users = [];
        
        if (supabase) {
            // ۱. دریافت کاربران از سیستم احراز هویت Supabase Auth
            try {
                const { data: authData, error: authErr } = await supabase.auth.admin.listUsers();
                if (!authErr && authData?.users?.length > 0) {
                    users = authData.users.map(u => ({
                        id: u.id,
                        email: u.email,
                        username: u.user_metadata?.username || u.user_metadata?.name || u.email?.split('@')[0] || '',
                        full_name: u.user_metadata?.full_name || u.user_metadata?.name || '',
                        created_at: u.created_at,
                        last_activity: u.last_sign_in_at,
                        metadata: u.user_metadata,
                    }));
                }
            } catch (e) {
                console.warn('Auth admin listUsers error:', e.message);
            }

            // ۲. دریافت از جدول profiles در دیتابیس Supabase
            try {
                let query = supabase.from('profiles').select('*').limit(limit);
                try {
                    query = query.order('created_at', { ascending: false });
                } catch (e) {}

                const { data: profilesData, error: profError } = await query;
                if (!profError && profilesData && profilesData.length > 0) {
                    if (users.length === 0) {
                        users = profilesData;
                    } else {
                        // ادغام دیتابیس با سیستم Auth
                        users = users.map(u => {
                            const prof = profilesData.find(p => p.id === u.id || p.email === u.email);
                            return prof ? { ...u, ...prof } : u;
                        });
                    }
                }
            } catch (e) {
                console.warn('Profiles query error:', e.message);
            }

            if (users.length > 0) {
                syncUsersToCache(users);
            }
        } else if (SITE_API_URL && SITE_API_KEY) {
            const response = await siteApiClient.get('/users', {
                params: {
                    sort: 'registration_date',
                    order: 'desc',
                    limit,
                    days,
                }
            });
            users = response.data.users || response.data;
            syncUsersToCache(users);
        } else {
            users = siteUsers.getRecent.all(limit);
        }

        log.log.run('GET_NEW_USERS', `دریافت ${users.length} کاربر جدید`, JSON.stringify(users.length), 1);
        return { success: true, count: users.length, users };
    } catch (error) {
        log.log.run('GET_NEW_USERS', 'خطا در دریافت کاربران', error.message, 0);
        return { success: false, error: error.message };
    }
}

/**
 * جستجوی کاربر خاص
 * @param {string} query - نام، ایمیل یا آیدی کاربر
 */
async function searchUser(query) {
    try {
        if (supabase) {
            // جستجو در کاربران ثبت‌نامی Supabase Auth
            try {
                const { data: authData } = await supabase.auth.admin.listUsers();
                if (authData?.users?.length > 0) {
                    const q = query.toLowerCase();
                    const matched = authData.users.filter(u => 
                        (u.email && u.email.toLowerCase().includes(q)) ||
                        (u.id && u.id.toLowerCase().includes(q)) ||
                        (u.user_metadata?.name && String(u.user_metadata.name).toLowerCase().includes(q)) ||
                        (u.user_metadata?.username && String(u.user_metadata.username).toLowerCase().includes(q)) ||
                        (u.user_metadata?.full_name && String(u.user_metadata.full_name).toLowerCase().includes(q))
                    );
                    if (matched.length > 0) {
                        const formatted = matched.map(u => ({
                            id: u.id,
                            email: u.email,
                            username: u.user_metadata?.username || u.user_metadata?.name || u.email?.split('@')[0],
                            full_name: u.user_metadata?.full_name || u.user_metadata?.name || '',
                            created_at: u.created_at,
                            last_activity: u.last_sign_in_at,
                        }));
                        syncUsersToCache(formatted);
                        return { success: true, users: formatted, source: 'supabase_auth' };
                    }
                }
            } catch (e) {}

            // جستجو در جدول profiles
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .or(`username.ilike.%${query}%,email.ilike.%${query}%,full_name.ilike.%${query}%`)
                .limit(10);

            if (!error && data && data.length > 0) {
                syncUsersToCache(data);
                return { success: true, users: data, source: 'supabase_profiles' };
            }
        }

        // جستجو در کش محلی
        const localResults = siteUsers.search.all(
            `%${query}%`, `%${query}%`, `%${query}%`
        );

        if (localResults.length > 0) {
            return { success: true, users: localResults, source: 'local_cache' };
        }

        return { success: true, users: [], message: 'کاربری با این مشخصات یافت نشد' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * دریافت پیشرفت کاربر
 * @param {string} userId - آیدی کاربر
 */
async function getUserProgress(userId) {
    try {
        let profile = null;

        if (supabase) {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (!error && data) {
                profile = data;
            }
        }

        const cachedUser = siteUsers.getById.get(String(userId));
        const user = profile || cachedUser;

        return {
            success: true,
            userId,
            user: user || null,
            progress: user?.progress || user?.data || {},
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * ارسال پیام مستقیم به کاربر سایت
 * @param {string} userId - آیدی کاربر
 * @param {string} message - متن پیام
 * @param {string} type - نوع پیام (info, warning, success)
 */
async function sendMessageToUser(userId, message, type = 'info') {
    try {
        if (supabase) {
            // درج در جدول اعلان‌ها / پیام‌ها در صورت وجود
            const { data, error } = await supabase
                .from('notifications')
                .insert({
                    user_id: userId,
                    content: message,
                    type: type,
                    created_at: new Date().toISOString()
                });

            if (!error) {
                log.log.run('SEND_USER_MESSAGE', `پیام به کاربر ${userId} در Supabase`, message, 1);
                return { success: true, message: 'پیام با موفقیت در Supabase ثبت شد' };
            }
        }

        log.log.run('SEND_USER_MESSAGE', `پیام به کاربر ${userId}`, message, 1);
        return { success: true, message: `پیام برای ارسال به کاربر ${userId} ثبت شد: "${message}"` };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * اضافه کردن یادداشت به پروفایل کاربر
 * @param {string} userId - آیدی کاربر
 * @param {string} note - یادداشت
 * @param {string[]} tags - برچسب‌ها
 */
async function addUserNote(userId, note, tags = []) {
    try {
        const user = siteUsers.getById.get(String(userId));
        const existingNotes = user?.notes || '';
        const newNote = `[${new Date().toLocaleString('fa-IR')}] ${note}`;
        const updatedNotes = existingNotes ? `${existingNotes}\n${newNote}` : newNote;

        const existingTags = JSON.parse(user?.tags || '[]');
        const updatedTags = [...new Set([...existingTags, ...tags])];

        siteUsers.addNote.run(updatedNotes, JSON.stringify(updatedTags), String(userId));
        
        log.log.run('ADD_USER_NOTE', `یادداشت برای کاربر ${userId}`, note, 1);
        return { success: true, message: 'یادداشت با موفقیت ذخیره شد' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * دریافت آمار کلی سایت
 */
async function getSiteStats() {
    try {
        let totalUsers = 0;
        if (supabase) {
            const { count, error } = await supabase
                .from('profiles')
                .select('*', { count: 'exact', head: true });
            if (!error) {
                totalUsers = count || 0;
            }
        }

        const allUsers = siteUsers.getAll.all();
        if (totalUsers === 0) totalUsers = allUsers.length;

        const stats = {
            total_users: totalUsers,
            database: supabase ? 'Supabase (متصل)' : 'Local Cache',
            cached_users: allUsers.length,
            last_checked: new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })
        };

        return { success: true, stats };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
    getNewUsers,
    searchUser,
    getUserProgress,
    sendMessageToUser,
    addUserNote,
    getSiteStats,
};
