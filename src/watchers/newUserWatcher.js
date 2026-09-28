/**
 * New User Watcher - پایشگر ثبت‌نام کاربران جدید
 * 
 * هر زمان کاربر جدیدی در سایت (جدول profiles یا Supabase Auth) ثبت‌نام کند،
 * فوراً به اکانت تلگرام شما پیام می‌دهد و مشخصاتش را اعلام می‌کند.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { memory } = require('../database/db');

let supabase = null;
const notifiedUsers = new Set();
let lastCheckedTimestamp = null;

/**
 * ارسال اعلان ثبت‌نام کاربر جدید به تلگرام مالک
 */
async function sendNewUserAlert(bot, user) {
    const ownerId = process.env.TELEGRAM_OWNER_ID;
    if (!bot || !ownerId) return;

    const userId = String(user.id || user.user_id || user.email);
    if (notifiedUsers.has(userId)) return; // قبلاً اعلان فرستاده شده

    notifiedUsers.add(userId);

    const name = user.full_name || user.name || user.username || user.display_name || 'نام مشخص نشده';
    const email = user.email || 'ایمیل ثبت نشده';
    const time = user.created_at ? new Date(user.created_at).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }) : new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });

    const message = `🎉 *رئیس، یه کاربر جدید تو سایت عضو شد!*\n\n` +
        `👤 *نام / کاربری:* ${name}\n` +
        `📧 *ایمیل:* \`${email}\`\n` +
        `🆔 *شناسه:* \`${userId}\`\n` +
        `🕒 *زمان ثبت‌نام:* ${time}\n\n` +
        `_می‌تونی از من بخوای پیشرفتش رو برات چک کنم یا بهش پیام بفرستی!_ 😉`;

    try {
        await bot.telegram.sendMessage(ownerId, message, { parse_mode: 'Markdown' });
        console.log(`📢 اعلان ثبت‌نام کاربر ${email} به تلگرام ارسال شد.`);
    } catch (err) {
        console.error('❌ خطا در ارسال اعلان کاربر جدید به تلگرام:', err.message);
    }
}

/**
 * راه‌اندازی دیده‌بان کاربران جدید
 */
function startNewUserWatcher(bot) {
    const siteUrl = process.env.SITE_API_URL;
    const siteKey = process.env.SITE_API_KEY;

    if (!siteUrl || !siteKey || !siteUrl.includes('supabase.co')) {
        console.log('ℹ️  پایشگر کاربران فعال نشد (تنظیمات Supabase ناقص است).');
        return;
    }

    try {
        supabase = createClient(siteUrl, siteKey);
        console.log('👀 پایشگر زنده کاربران جدید (Realtime Watcher) فعال شد...');

        // ۱. پایش بلادرنگ (WebSockets Realtime) با Supabase
        try {
            supabase
                .channel('realtime_profiles')
                .on(
                    'postgres_changes',
                    { event: 'INSERT', schema: 'public', table: 'profiles' },
                    (payload) => {
                        console.log('🔔 کاربر جدید در Realtime دریافت شد:', payload.new);
                        sendNewUserAlert(bot, payload.new);
                    }
                )
                .subscribe();
        } catch (e) {
            console.warn('Realtime channel error:', e.message);
        }

        // ۲. همگام‌سازی اولیه و علامت‌گذاری کاربران موجود (تا برای قبلی‌ها پیام ندهد)
        (async () => {
            try {
                // دریافت کاربران فعلی از profiles
                const { data: existingProfiles } = await supabase.from('profiles').select('*');
                if (existingProfiles) {
                    existingProfiles.forEach(p => notifiedUsers.add(String(p.id)));
                }

                // دریافت کاربران فعلی از Auth
                const { data: authData } = await supabase.auth.admin.listUsers();
                if (authData?.users) {
                    authData.users.forEach(u => notifiedUsers.add(String(u.id)));
                }

                lastCheckedTimestamp = new Date();
                console.log(`👥 تعداد ${notifiedUsers.size} کاربر اولیه شناسایی شدند (فقط ثبت‌نام‌های جدید اعلان می‌شوند).`);
            } catch (err) {
                console.warn('⚠️ خطا در دریافت اولیه لیست کاربران:', err.message);
            }
        })();

        // ۳. پایش دوره‌ای (هر ۶۰ ثانیه یک‌بار) به عنوان پشتیبان
        setInterval(async () => {
            try {
                // الف) بررسی جدول profiles
                const { data: newProfiles } = await supabase
                    .from('profiles')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(5);

                if (newProfiles && newProfiles.length > 0) {
                    for (const p of newProfiles) {
                        const pid = String(p.id);
                        if (!notifiedUsers.has(pid)) {
                            await sendNewUserAlert(bot, p);
                        }
                    }
                }

                // ب) بررسی سیستم Supabase Auth
                const { data: authData } = await supabase.auth.admin.listUsers({
                    page: 1,
                    perPage: 5
                });

                if (authData?.users && authData.users.length > 0) {
                    for (const u of authData.users) {
                        const uid = String(u.id);
                        if (!notifiedUsers.has(uid)) {
                            await sendNewUserAlert(bot, {
                                id: u.id,
                                email: u.email,
                                name: u.user_metadata?.full_name || u.user_metadata?.name || u.email,
                                created_at: u.created_at
                            });
                        }
                    }
                }
            } catch (e) {
                // خطا در چک دوره‌ای
            }
        }, 60 * 1000); // هر ۶۰ ثانیه

    } catch (err) {
        console.error('❌ خطا در راه‌اندازی پایشگر کاربران:', err.message);
    }
}

module.exports = { startNewUserWatcher };
