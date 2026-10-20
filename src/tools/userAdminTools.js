/**
 * User Admin Tools - عملیات مدیریتی روی حساب کاربران LyricBaz
 *
 * فقط از سمت سرور و با کلید service_role صدا زده می‌شود.
 * حذف کاربر از auth.users انجام می‌شود و به‌خاطر ON DELETE CASCADE،
 * پروفایل، پیشرفت، کارت‌های لایتنر، نشان‌ها و اشتراک نوتیفیکیشن هم پاک می‌شوند.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SITE_API_URL = process.env.SITE_API_URL || '';
const SERVICE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SITE_SERVICE_ROLE_KEY ||
    process.env.SITE_API_KEY ||
    '';

let supabase = null;
try {
    if (SITE_API_URL && SERVICE_KEY && SITE_API_URL.includes('supabase.co')) {
        supabase = createClient(SITE_API_URL, SERVICE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
    }
} catch (err) {
    console.warn('⚠️ اتصال Supabase برای مدیریت کاربران برقرار نشد:', err.message);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUserId(userId) {
    return typeof userId === 'string' && UUID_RE.test(userId);
}

/**
 * پاک کردن کامل حساب کاربر
 * @param {string} userId شناسه Supabase Auth
 */
async function deleteUserAccount(userId) {
    if (!supabase) {
        return { success: false, error: 'اتصال Supabase با کلید مدیریتی تنظیم نشده است.' };
    }
    if (!isValidUserId(userId)) {
        return { success: false, error: 'شناسه کاربر نامعتبر است.' };
    }

    try {
        // اطلاعات کاربر را قبل از حذف می‌گیریم تا در گزارش/لاگ قابل شناسایی باشد
        let email = '';
        let displayName = '';
        const { data: existing, error: fetchError } = await supabase.auth.admin.getUserById(userId);

        if (fetchError || !existing?.user) {
            return { success: false, error: 'کاربری با این شناسه پیدا نشد (شاید قبلاً حذف شده است).' };
        }

        email = existing.user.email || '';
        displayName =
            existing.user.user_metadata?.full_name ||
            existing.user.user_metadata?.name ||
            email;

        const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
        if (deleteError) {
            return { success: false, error: deleteError.message };
        }

        return {
            success: true,
            id: userId,
            email,
            name: displayName,
            message: 'حساب کاربری و تمام اطلاعات مرتبط با آن حذف شد.',
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    deleteUserAccount,
    isValidUserId,
};
