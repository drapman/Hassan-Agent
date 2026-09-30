/**
 * Site Users Tool - ابزارهای مدیریت کاربران سایت
 * 
 * پشتیبانی مستقیم و نیتیو از Supabase + REST API
 */

require('dotenv').config();
const axios = require('axios');
const { db, siteUsers, log } = require('../database/db');

const SITE_API_URL = process.env.SITE_API_URL || '';
const SITE_API_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SITE_SERVICE_ROLE_KEY || process.env.SITE_API_KEY || '';
const SITE_ADMIN_EMAIL = process.env.SITE_ADMIN_EMAIL || 'parsa_learner@gmail.com';
const SITE_ADMIN_PASSWORD = process.env.SITE_ADMIN_PASSWORD || 'Password123456!';

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

function checkServiceRole(key) {
    if (!key) return false;
    try {
        if (key.includes('service_role')) return true;
        if (key.startsWith('eyJ')) {
            const parts = key.split('.');
            if (parts.length >= 2) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                return payload.role === 'service_role';
            }
        }
    } catch (e) {}
    return false;
}

const hasServiceRole = checkServiceRole(SITE_API_KEY) || 
                       checkServiceRole(process.env.SUPABASE_SERVICE_ROLE_KEY) || 
                       checkServiceRole(process.env.SITE_SERVICE_ROLE_KEY);

if (hasServiceRole) {
    console.log('👑 کلید امنیتی سطح روت (Service Role Key) شناسایی شد - تمام محدودیت‌های RLS دور زده می‌شوند.');
}

let authPromise = null;
/**
 * احراز هویت خودکار جهت دور زدن RLS در صورت استفاده از کلید معمولی (Anon)
 */
async function ensureAuth() {
    if (!supabase || hasServiceRole) return null;
    try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session) return sessionData.session;
        if (authPromise) return authPromise;

        authPromise = (async () => {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: SITE_ADMIN_EMAIL,
                password: SITE_ADMIN_PASSWORD
            });
            if (error) {
                console.warn('⚠️ ورود خودکار به Supabase:', error.message);
                return null;
            }
            console.log('✅ ورود خودکار بات به Supabase موفقیت‌آمیز بود:', data.user?.email);
            return data.session;
        })();
        const session = await authPromise;
        authPromise = null;
        return session;
    } catch (e) {
        authPromise = null;
        console.warn('⚠️ خطا در ensureAuth:', e.message);
        return null;
    }
}

if (supabase && !hasServiceRole) {
    ensureAuth().catch(() => {});
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
    const activeIds = new Set(users.map(u => String(u.id || u.site_user_id)).filter(Boolean));

    // حذف کاربرانی که از دیتابیس آنلاین حذف شده‌اند
    try {
        const cached = siteUsers.getAll.all();
        cached.forEach(c => {
            if (!activeIds.has(String(c.site_user_id))) {
                db.prepare('DELETE FROM site_users WHERE site_user_id = ?').run(c.site_user_id);
            }
        });
    } catch (e) {}
    users.forEach(user => {
        try {
            siteUsers.upsert.run({
                site_user_id: String(user.id || user._id || user.user_id),
                username: user.username || user.name || user.email?.split('@')[0] || '',
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
 * دریافت یکپارچه و ۱۰۰٪ هماهنگ تمام کاربران از Supabase
 */
async function fetchAllSupabaseUsers() {
    if (!supabase) return [];
    try {
        await ensureAuth();
        let authUsers = [];
        let profiles = [];

        if (hasServiceRole) {
            try {
                const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
                if (data?.users) authUsers = data.users;
            } catch (err) {
                console.warn('Auth admin listUsers error:', err.message);
            }
        }

        try {
            const { data } = await supabase.from('profiles').select('*');
            if (data) profiles = data;
        } catch (err) {
            console.warn('Profiles query error:', err.message);
        }

        const unifiedMap = new Map();

        // ۱. پردازش جدول profiles
        profiles.forEach(p => {
            unifiedMap.set(p.id, {
                id: p.id,
                username: p.username || '',
                email: p.email || '',
                full_name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.username || '',
                created_at: p.created_at || new Date().toISOString(),
                last_activity: p.last_study_date || p.last_practice_date || p.updated_at || null,
                xp: p.xp || 0,
                streak_days: p.streak_days || 0,
                songs_completed: p.songs_completed || 0,
                quizzes_passed: p.quizzes_passed || 0,
                words_learned: p.words_learned || 0,
                proficiency_level: p.proficiency_level || 'beginner',
                musical_interests: p.musical_interests || [],
                profile: p,
            });
        });

        // ۲. ادغام کامل با auth.users بر اساس User ID
        authUsers.forEach(u => {
            const existing = unifiedMap.get(u.id);
            const userMeta = u.user_metadata || {};
            const resolvedUsername = existing?.username || userMeta.username || userMeta.name || u.email?.split('@')[0] || '';
            const resolvedEmail = u.email || existing?.email || '';
            const resolvedFullName = existing?.full_name || userMeta.full_name || userMeta.name || '';

            if (existing) {
                if (!existing.email) existing.email = resolvedEmail;
                if (!existing.username) existing.username = resolvedUsername;
                if (!existing.full_name) existing.full_name = resolvedFullName;
                existing.last_activity = existing.last_activity || u.last_sign_in_at;
                existing.metadata = userMeta;
            } else {
                unifiedMap.set(u.id, {
                    id: u.id,
                    username: resolvedUsername,
                    email: resolvedEmail,
                    full_name: resolvedFullName,
                    created_at: u.created_at || new Date().toISOString(),
                    last_activity: u.last_sign_in_at,
                    metadata: userMeta,
                    xp: 0,
                    streak_days: 0,
                    songs_completed: 0,
                    quizzes_passed: 0,
                    words_learned: 0,
                    proficiency_level: 'beginner',
                    musical_interests: [],
                });
            }
        });

        // ۳. ادغام کاربران از جدول عمومی leaderboard_weekly
        try {
            const { data: lb } = await supabase.from('leaderboard_weekly').select('*');
            if (lb && lb.length > 0) {
                lb.forEach(row => {
                    const uid = row.user_id;
                    if (!uid) return;
                    const existing = unifiedMap.get(uid);
                    if (!existing) {
                        unifiedMap.set(uid, {
                            id: uid,
                            username: row.username || 'کاربر سایت',
                            email: '',
                            full_name: row.username || '',
                            created_at: row.created_at || new Date().toISOString(),
                            last_activity: row.updated_at || null,
                            xp: row.xp_earned || 0,
                            streak_days: 0,
                            songs_completed: row.songs_completed || 0,
                            quizzes_passed: row.quizzes_passed || 0,
                            words_learned: 0,
                            proficiency_level: 'beginner',
                            musical_interests: [],
                        });
                    } else {
                        existing.xp = Math.max(existing.xp || 0, row.xp_earned || 0);
                        existing.songs_completed = Math.max(existing.songs_completed || 0, row.songs_completed || 0);
                        existing.quizzes_passed = Math.max(existing.quizzes_passed || 0, row.quizzes_passed || 0);
                        if (!existing.username || existing.username === 'Learner') existing.username = row.username;
                    }
                });
            }
        } catch (err) {
            console.warn('Leaderboard query error:', err.message);
        }

        const list = Array.from(unifiedMap.values());
        list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        syncUsersToCache(list);
        return list;
    } catch (e) {
        console.warn('fetchAllSupabaseUsers error:', e.message);
        return [];
    }
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
            const allUsers = await fetchAllSupabaseUsers();
            users = allUsers.slice(0, limit);
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
        const q = String(query).toLowerCase().trim();

        if (supabase) {
            const allUsers = await fetchAllSupabaseUsers();
            const matched = allUsers.filter(u => 
                (u.email && u.email.toLowerCase().includes(q)) ||
                (u.id && u.id.toLowerCase().includes(q)) ||
                (u.username && u.username.toLowerCase().includes(q)) ||
                (u.full_name && u.full_name.toLowerCase().includes(q))
            );

            if (matched.length > 0) {
                return { success: true, users: matched, source: 'supabase_unified' };
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
 * دریافت پیشرفت کامل و ریز جزئیات تسک‌ها و یادگیری کاربر
 * @param {string} userId - آیدی کاربر
 */
async function getUserProgress(userId) {
    try {
        let profile = null;
        let authUser = null;
        let leitnerCards = [];
        let achievements = [];

        if (supabase) {
            await ensureAuth();
            // ۱. اطلاعات پروفایل و امتیازات
            const { data: prof, error: profErr } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .maybeSingle();
            if (!profErr && prof) profile = prof;

            // در صورت عدم دسترسی مستقیم به دلیل RLS، از جدول عمومی لیدربورد بازیابی کن
            if (!profile) {
                try {
                    const { data: lbRow } = await supabase
                        .from('leaderboard_weekly')
                        .select('*')
                        .eq('user_id', userId)
                        .maybeSingle();
                    if (lbRow) {
                        profile = {
                            id: userId,
                            username: lbRow.username,
                            xp: lbRow.xp_earned || 0,
                            songs_completed: lbRow.songs_completed || 0,
                            quizzes_passed: lbRow.quizzes_passed || 0,
                        };
                    }
                } catch (e) {}
            }

            // ۲. کلمات و کارت‌های لایتنر (تسک‌های یادگیری)
            const { data: cards } = await supabase
                .from('leitner_cards')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(50);
            leitnerCards = cards || [];

            // ۳. پیشرفت آهنگ‌ها و آزمون‌ها (song_progress)
            var songProgressList = [];
            try {
                const { data: sp } = await supabase
                    .from('song_progress')
                    .select('*')
                    .eq('user_id', userId)
                    .order('updated_at', { ascending: false });
                songProgressList = sp || [];
            } catch (e) {}

            // ۴. دستاوردها و مدال‌ها
            const { data: achs } = await supabase
                .from('user_achievements')
                .select('*')
                .eq('user_id', userId);
            achievements = (achs || []).map(a => {
                const map = {
                    'early_bird': { title: 'سحرخیز 🌅', desc: 'شروع زودهنگام تمرین روزانه' },
                    'first_quiz': { title: 'اولین کوییز 🎯', desc: 'پاس کردن موفقیت‌آمیز آزمون اول' },
                    'word_master': { title: 'استاد واژگان 📚', desc: 'تکمیل مرور کلمات لایتنر' },
                    'streak_3': { title: 'زنجیره ۳ روزه 🔥', desc: '۳ روز تمرین مداوم' },
                    'streak_7': { title: 'زنجیره هفتگی ⚡', desc: '۷ روز تمرین بدون وقفه' }
                };
                const info = map[a.achievement_id] || { title: a.achievement_id, desc: 'دستاورد کسب شده' };
                return {
                    ...a,
                    title: info.title,
                    description: info.desc,
                    earned_date: a.earned_at ? new Date(a.earned_at).toLocaleDateString('fa-IR') : ''
                };
            });

            // ۵. تسک‌ها و ماموریت‌های روزانه (user_daily_xp_log)
            var dailyMissions = [];
            var dailyLog = null;
            try {
                const { data: logs } = await supabase
                    .from('user_daily_xp_log')
                    .select('*')
                    .eq('user_id', userId)
                    .order('activity_date', { ascending: false })
                    .limit(1);

                if (logs && logs.length > 0) {
                    dailyLog = logs[0];
                    if (dailyLog.missions && Array.isArray(dailyLog.missions.missions)) {
                        const progMap = dailyLog.missions.progress || {};
                        dailyMissions = dailyLog.missions.missions.map(m => {
                            const p = progMap[m.id] || {};
                            return {
                                id: m.id,
                                title: m.titleFa || m.title || 'ماموریت روزانه',
                                description: m.descriptionFa || m.description || '',
                                emoji: m.emoji || '🎯',
                                difficulty: m.difficulty || 'medium',
                                xpReward: m.xpReward || 10,
                                requirement: m.requirement || 1,
                                currentProgress: p.currentProgress || 0,
                                completed: p.completed || false
                            };
                        });
                    }
                }
            } catch (e) {
                console.warn('خطا در خواندن ماموریت‌های روزانه:', e.message);
            }

            // ۶. اطلاعات سیستم Auth
            if (hasServiceRole) {
                try {
                    const { data: authData } = await supabase.auth.admin.getUserById(userId);
                    authUser = authData?.user || null;
                } catch (e) {}
            }
        }

        const cachedUser = siteUsers.getById.get(String(userId));
        const userObj = {
            ...(cachedUser || {}),
            ...(profile || {}),
            email: authUser?.email || profile?.email || cachedUser?.email || 'بدون ایمیل',
            last_sign_in_at: authUser?.last_sign_in_at || profile?.last_study_date || cachedUser?.last_activity,
        };

        const totalXp = Math.max(profile?.xp || 0, dailyLog?.total_xp || 0);
        const resolvedSongsCompleted = Math.max(profile?.songs_completed || 0, (songProgressList || []).filter(s => s.status === 'completed').length);
        const resolvedQuizzesPassed = Math.max(profile?.quizzes_passed || 0, (songProgressList || []).filter(s => (s.quiz_score || 0) >= 70).length);

        return {
            success: true,
            userId,
            user: userObj,
            progress: {
                xp: totalXp,
                vocabXp: dailyLog?.vocab_xp || 0,
                quizXp: dailyLog?.quiz_xp || 0,
                streakDays: profile?.streak_days || profile?.streak_count || 0,
                proficiencyLevel: profile?.proficiency_level || 'beginner',
                songsCompleted: resolvedSongsCompleted,
                quizzesPassed: resolvedQuizzesPassed,
                wordsLearned: profile?.words_learned || profile?.words_count_total || leitnerCards.length || 0,
                leitnerDue: profile?.leitner_due_count || 0,
                leitnerMastered: profile?.leitner_mastered_count || 0,
                leitnerTotal: profile?.leitner_total_count || leitnerCards.length || 0,
                musicalInterests: profile?.musical_interests || [],
                lastStudyDate: profile?.last_study_date || profile?.last_practice_date || null
            },
            dailyMissions: dailyMissions || [],
            dailyLog: dailyLog || null,
            leitnerCards,
            songProgress: songProgressList || [],
            achievements,
            notes: cachedUser?.notes || '',
            tags: JSON.parse(cachedUser?.tags || '[]')
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
            await ensureAuth();
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
            await ensureAuth();
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
