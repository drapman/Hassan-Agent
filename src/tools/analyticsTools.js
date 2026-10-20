/**
 * Analytics Tools - آمار و رویدادهای سایت LyricBaz برای ربات تلگرام
 *
 * داده‌ها از تابع `analytics_overview` در Supabase خوانده می‌شوند. ربات با
 * کلید service_role (همان SITE_API_KEY) کار می‌کند، بنابراین دسترسی کامل دارد
 * ولی جدول برای کلاینت‌های عادی همچنان بسته است.
 *
 * خروجی‌ها HTML تلگرام هستند (parse_mode: 'HTML').
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { memory } = require('../database/db');

let supabase = null;
try {
    const url = process.env.SITE_API_URL;
    const key = process.env.SITE_API_KEY;
    if (url && key && url.includes('supabase.co')) {
        supabase = createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
    }
} catch (err) {
    console.warn('⚠️ اتصال Supabase برای آمار برقرار نشد:', err.message);
}

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const REFERRER_LABELS = {
    direct: 'ورود مستقیم',
    'google.com': 'گوگل',
    'www.google.com': 'گوگل',
    'google.co.uk': 'گوگل',
    't.me': 'تلگرام',
    'telegram.org': 'تلگرام',
    'web.telegram.org': 'تلگرام',
    'instagram.com': 'اینستاگرام',
    'www.instagram.com': 'اینستاگرام',
    'youtube.com': 'یوتیوب',
    'www.youtube.com': 'یوتیوب',
    'x.com': 'ایکس (توییتر)',
    'twitter.com': 'ایکس (توییتر)',
    'facebook.com': 'فیسبوک',
    'www.facebook.com': 'فیسبوک',
    'linkedin.com': 'لینکدین',
    'bing.com': 'بینگ',
    'www.bing.com': 'بینگ',
    'duckduckgo.com': 'داک‌داک‌گو',
};

const DEVICE_LABELS = {
    desktop: 'دسکتاپ',
    mobile: 'موبایل',
    tablet: 'تبلت',
    unknown: 'نامشخص',
};

const PAGE_LABELS = {
    '/': 'خانه',
    '/library': 'کتابخانه آهنگ‌ها',
    '/treasure': 'گنجینه',
    '/vocab-surgery': 'واژگان',
    '/leitner': 'جعبه لایتنر',
    '/leaderboard': 'جدول امتیازات',
    '/badges': 'نشان‌ها',
    '/profile': 'پروفایل',
    '/admin/analytics': 'داشبورد آمار',
};

function sourceLabel(source) {
    if (!source) return 'نامشخص';
    return REFERRER_LABELS[source] || source;
}

function pageLabel(path) {
    if (!path) return 'نامشخص';
    if (PAGE_LABELS[path]) return PAGE_LABELS[path];
    if (path.startsWith('/song/')) return `آهنگ: ${path.slice(6)}`;
    return path;
}

/** عنوان خوانا برای آهنگ (وقتی props.title ثبت نشده و path خام است) */
function songLabel(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'بدون نام';
    if (raw.startsWith('/song/') || raw.startsWith('song/')) {
        return raw
            .replace(/^\/?song\//, '')
            .replace(/\/+$/, '')
            .replace(/[-_]+/g, ' ')
            .trim();
    }
    return raw;
}

function rangeLabel(days) {
    const d = Number(days) || 7;
    if (d <= 1) return 'امروز';
    if (d === 7) return '۷ روز اخیر';
    if (d === 30) return '۳۰ روز اخیر';
    if (d === 90) return '۹۰ روز اخیر';
    return `${faNum(d)} روز اخیر`;
}

/** YYYY-MM-DD → ۱۴۰۵/۰۷/۲۸ */
function jalaliDay(day) {
    try {
        return new Date(`${day}T12:00:00Z`).toLocaleDateString('fa-IR', {
            timeZone: 'UTC',
            month: '2-digit',
            day: '2-digit',
        });
    } catch {
        return day;
    }
}

function jalaliDateTime(value) {
    try {
        return new Date(value || Date.now()).toLocaleString('fa-IR', {
            timeZone: 'Asia/Tehran',
            dateStyle: 'short',
            timeStyle: 'short',
        });
    } catch {
        return '';
    }
}

function trendSuffix(current, previous) {
    const now = Number(current) || 0;
    const before = Number(previous) || 0;
    if (before === 0) return now > 0 ? ' · <i>جدید</i>' : '';
    const diff = Math.round(((now - before) / before) * 100);
    if (diff === 0) return ' · بی‌تغییر';
    return ` · ${diff > 0 ? '▲' : '▼'} ${faNum(Math.abs(diff))}٪`;
}

function bar(value, max) {
    if (!max || !value) return '';
    const filled = Math.max(1, Math.round((value / max) * 10));
    return '▇'.repeat(filled);
}

/** بریدن متن‌های طولانی (پیام خطا، آدرس) */
function clip(text, max = 60) {
    const s = String(text ?? '');
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** اگر HTML تلگرام را نپذیرفت، همین متن را ساده بفرست */
function toPlain(html) {
    return String(html)
        .replace(/<\/?[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

// ──────────────────────────────────────────────────
// Data
// ──────────────────────────────────────────────────

/**
 * دریافت خلاصهٔ آمار
 * @param {number} days - بازه به روز (۱ تا ۳۶۵)
 */
async function getOverview(days = 7) {
    if (!supabase) {
        return {
            success: false,
            error: 'اتصال Supabase تنظیم نشده. SITE_API_URL و SITE_API_KEY را در .env بگذار.',
        };
    }

    const safeDays = Math.max(1, Math.min(Number(days) || 7, 365));

    try {
        const { data, error } = await supabase.rpc('analytics_overview', { p_days: safeDays });
        if (error) {
            return { success: false, error: error.message };
        }

        // آمار یادآور روزانه (اختیاری: اگر تابع نبود، گزارش اصلی نباید بشکند)
        let reminders = null;
        try {
            const res = await supabase.rpc('reminder_stats');
            if (!res.error) reminders = res.data;
        } catch {
            reminders = null;
        }

        return { success: true, days: safeDays, overview: { ...(data || {}), reminders } };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

const FUNNEL_META = {
    signup_view: { label: '👀 دیدن فرم ثبت‌نام', icon: 'view' },
    signup_submit: { label: '📝 ارسال فرم', icon: 'submit' },
    signup_success: { label: '✅ ثبت‌نام موفق', icon: 'success' },
    login_success: { label: '🔓 ورود موفق', icon: 'login' },
};

/**
 * ساخت گزارش HTML از خروجی analytics_overview
 */
function formatOverview(overview, days = 7) {
    if (!overview) return '📭 آماری برای نمایش نیست.';

    const totals = overview.totals || {};
    const prev = overview.previous || {};
    const site = overview.site || {};
    const daily = Array.isArray(overview.daily) ? overview.daily : [];
    const funnel = Array.isArray(overview.funnel) ? overview.funnel : [];
    const songs = Array.isArray(overview.top_songs) ? overview.top_songs : [];
    const paths = Array.isArray(overview.top_paths) ? overview.top_paths : [];
    const referrers = Array.isArray(overview.referrers) ? overview.referrers : [];
    const devices = Array.isArray(overview.devices) ? overview.devices : [];
    const errors = Array.isArray(overview.errors) ? overview.errors : [];
    const reminders = overview.reminders || {};

    const pageviews = Number(totals.pageviews) || 0;
    const visitors = Number(totals.visitors) || 0;
    const signups = Number(totals.signups) || 0;
    const signupViews = Number((funnel.find((f) => f.event === 'signup_view') || {}).sessions) || 0;

    const lines = [];

    lines.push(`📊 <b>آمار LyricBaz — ${rangeLabel(days)}</b>`);
    lines.push(`🕒 به‌روزرسانی: ${jalaliDateTime(Date.now())}`);
    lines.push('');

    // ── خلاصه
    lines.push(`👣 <b>${faNum(pageviews)}</b> بازدید صفحه${trendSuffix(pageviews, prev.pageviews)}`);
    lines.push(`🧑 <b>${faNum(visitors)}</b> بازدیدکننده یکتا`);
    if (Number(site.live_now) > 0) {
        lines.push(`🟢 <b>${faNum(site.live_now)}</b> نفر همین حالا آنلاین`);
    }
    lines.push(`🎵 <b>${faNum(totals.song_opens)}</b> باز شدن آهنگ${trendSuffix(totals.song_opens, prev.song_opens)}`);
    lines.push(
        `✍️ <b>${faNum(signups)}</b> ثبت‌نام جدید` +
        (signups > 0 && signupViews > 0 ? ` · نرخ تبدیل ${faNum(percent(signups, signupViews))}٪` : '') +
        trendSuffix(signups, prev.signups)
    );
    lines.push(`👥 <b>${faNum(site.total_users)}</b> کاربر کل · <b>${faNum(site.new_users)}</b> تازه در این بازه`);
    lines.push(
        `🚨 <b>${faNum(totals.errors)}</b> خطا` +
        (Number(totals.errors) > 0 && Number(prev.errors) > 0 ? trendSuffix(totals.errors, prev.errors) : '')
    );
    if (Number(reminders.subscribers) > 0) {
        const notified = Number(reminders.notified_today) || 0;
        lines.push(
            `🔔 <b>${faNum(reminders.subscribers)}</b> نفر یادآور روزانه را روشن کرده‌اند` +
            (notified > 0 ? ` · امروز ${faNum(notified)} یادآوری رفت` : ' · امروز هنوز یادآوری نرفته')
        );
    } else {
        lines.push('🔔 هنوز کسی یادآور روزانه را روشن نکرده');
    }

    // ── نمودار روزانه
    const recentDays = daily.slice(-7);
    if (recentDays.length > 0) {
        lines.push('');
        lines.push('📈 <b>بازدید روزانه</b>');
        const max = Math.max(...recentDays.map((d) => Number(d.pageviews) || 0), 1);
        recentDays.forEach((d) => {
            const pv = Number(d.pageviews) || 0;
            const extra = Number(d.signups) > 0 ? ` · ✍️ ${faNum(d.signups)}` : '';
            lines.push(`${jalaliDay(d.day)}  ${bar(pv, max)} ${faNum(pv)}${extra}`);
        });
    }

    // ── قیف ثبت‌نام
    if (funnel.length > 0) {
        lines.push('');
        lines.push('🔻 <b>قیف ثبت‌نام</b>');
        const order = ['signup_view', 'signup_submit', 'signup_success', 'login_success'];
        order.forEach((key) => {
            const row = funnel.find((f) => f.event === key);
            if (!row) return;
            const meta = FUNNEL_META[key];
            const count = Number(row.sessions) || 0;
            const share = key === 'signup_view'
                ? ''
                : ` (${faNum(percent(count, signupViews || Number(row.sessions) || 1))}٪)`;
            lines.push(`${meta.label}: <b>${faNum(count)}</b> نفر${share}`);
        });
    }

    // ── آهنگ‌ها
    if (songs.length > 0) {
        lines.push('');
        lines.push('🎧 <b>پرطرفدارترین آهنگ‌ها</b>');
        songs.slice(0, 5).forEach((s, i) => {
            lines.push(`${faNum(i + 1)}. ${esc(clip(songLabel(s.title), 40))} — ${faNum(s.opens)} بار`);
        });
    }

    // ── صفحه‌ها
    if (paths.length > 0) {
        lines.push('');
        lines.push('📄 <b>پربازدیدترین صفحه‌ها</b>');
        paths.slice(0, 5).forEach((p) => {
            lines.push(`• ${esc(pageLabel(p.path))} — ${faNum(p.views)}`);
        });
    }

    // ── منابع ورود
    if (referrers.length > 0) {
        lines.push('');
        lines.push('🌐 <b>منبع ورود</b>');
        referrers.slice(0, 4).forEach((r) => {
            lines.push(`• ${esc(sourceLabel(r.source))}: ${faNum(r.sessions)}`);
        });
    }

    // ── دستگاه
    if (devices.length > 0) {
        lines.push('');
        lines.push(
            '📱 <b>دستگاه‌ها</b>: ' +
            devices
                .map((d) => `${DEVICE_LABELS[d.device] || esc(d.device)} ${faNum(d.sessions)}`)
                .join(' · ')
        );
    }

    // ── خطاها
    lines.push('');
    if (errors.length > 0) {
        lines.push('🚨 <b>خطاهای اخیر</b>');
        errors.slice(0, 3).forEach((e) => {
            lines.push(
                `• <code>${esc(clip(e.message, 55))}</code> — ${faNum(e.total)} بار\n` +
                `   ↳ ${esc(pageLabel(e.path))}`
            );
        });
        if (errors.length > 3) {
            lines.push(`<i>و ${faNum(errors.length - 3)} خطای دیگر…</i>`);
        }
    } else {
        lines.push('✅ هیچ خطایی ثبت نشده.');
    }

    let text = lines.join('\n');
    if (text.length > 3900) {
        text = `${text.slice(0, 3900)}\n…`;
    }
    return text;
}

/**
 * گزارش کوتاه خطاها (برای دکمهٔ «خطاها» و هشدار خودکار)
 */
function formatErrors(overview, days = 1, limit = 8) {
    const errors = (overview && Array.isArray(overview.errors)) ? overview.errors : [];
    const total = Number((overview && overview.totals && overview.totals.errors) || 0);

    if (errors.length === 0) {
        return `✅ <b>هیچ خطایی ثبت نشده</b>\n🕒 ${rangeLabel(days)}`;
    }

    const lines = [`🚨 <b>خطاهای کاربران — ${rangeLabel(days)}</b>`, `مجموع: <b>${faNum(total)}</b> خطا`, ''];
    errors.slice(0, limit).forEach((e, i) => {
        lines.push(
            `${faNum(i + 1)}. <code>${esc(clip(e.message, 70))}</code>\n` +
            `   ${faNum(e.total)} بار · ${esc(pageLabel(e.path))}\n` +
            `   آخرین: ${jalaliDateTime(e.last_seen)}`
        );
    });
    if (errors.length > limit) {
        lines.push(`\n<i>و ${faNum(errors.length - limit)} مورد دیگر…</i>`);
    }
    return lines.join('\n');
}

// ──────────────────────────────────────────────────
// Memory (برای جلوگیری از ارسال تکراری)
// ──────────────────────────────────────────────────

function remember(key) {
    try {
        const row = memory.get.get(key);
        return row ? row.value : null;
    } catch {
        return null;
    }
}

function rememberSet(key, value) {
    try {
        memory.set.run(key, String(value), 'analytics');
    } catch {
        // حافظه اختیاری است؛ اگر کار نکرد، فقط تکرار احتمالی داریم
    }
}

// ──────────────────────────────────────────────────
// Telegram senders
// ──────────────────────────────────────────────────

async function sendReport(bot, chatId, days) {
    const res = await getOverview(days);
    if (!res.success) {
        await bot.telegram.sendMessage(chatId, `❌ آمار در دسترس نیست:\n${res.error}`);
        return { success: false, error: res.error };
    }

    const html = formatOverview(res.overview, days);
    try {
        await bot.telegram.sendMessage(chatId, html, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
    } catch (err) {
        await bot.telegram.sendMessage(chatId, toPlain(html));
    }
    return { success: true, overview: res.overview };
}

// ──────────────────────────────────────────────────
// Watchers
// ──────────────────────────────────────────────────

/**
 * گزارش روزانه در ساعت مشخص (پیش‌فرض ۲۱ به وقت تهران)
 */
function startAnalyticsDigest(bot) {
    const ownerId = process.env.TELEGRAM_OWNER_ID;
    if (!ownerId) return;

    if (String(process.env.ANALYTICS_DIGEST || 'true').toLowerCase() === 'false') {
        console.log('ℹ️  گزارش روزانهٔ آمار غیرفعال شد (ANALYTICS_DIGEST=false).');
        return;
    }

    const hour = Math.max(0, Math.min(parseInt(process.env.ANALYTICS_DIGEST_HOUR || '21', 10) || 21, 23));

    const tick = async () => {
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Tehran',
                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
            }).formatToParts(new Date());
            const get = (type) => parts.find((p) => p.type === type)?.value;
            const today = `${get('year')}-${get('month')}-${get('day')}`;
            const currentHour = parseInt(get('hour'), 10);

            if (currentHour < hour) return;
            if (remember('analytics_digest_sent') === today) return;

            rememberSet('analytics_digest_sent', today);

            const res = await sendReport(bot, ownerId, 1);
            if (res.success) {
                console.log('📤 گزارش روزانهٔ آمار به تلگرام ارسال شد.');
            }
        } catch (err) {
            console.error('❌ خطا در گزارش روزانهٔ آمار:', err.message);
        }
    };

    setTimeout(tick, 30 * 1000);
    setInterval(tick, 10 * 60 * 1000);
    console.log(`📊 گزارش روزانهٔ آمار فعال شد (ساعت ${hour} به وقت تهران).`);
}

/**
 * هشدار فوری وقتی خطای جدیدی از کاربران می‌رسد
 */
function startErrorWatcher(bot) {
    const ownerId = process.env.TELEGRAM_OWNER_ID;
    if (!ownerId || !supabase) return;

    if (String(process.env.ANALYTICS_ERROR_ALERTS || 'true').toLowerCase() === 'false') {
        console.log('ℹ️  هشدار خطاها غیرفعال شد (ANALYTICS_ERROR_ALERTS=false).');
        return;
    }

    const INTERVAL_MS = 10 * 60 * 1000;
    const COOLDOWN_MS = 60 * 60 * 1000; // هر پیام خطا حداکثر هر یک ساعت

    const tick = async () => {
        try {
            const now = Date.now();
            const lastCheck = parseInt(remember('analytics_errors_last_check') || '0', 10) || (now - INTERVAL_MS);
            rememberSet('analytics_errors_last_check', now);

            const since = new Date(lastCheck - 60 * 1000).toISOString();

            const { data, error } = await supabase
                .from('analytics_events')
                .select('props, path, occurred_at')
                .eq('event', 'client_error')
                .gte('occurred_at', since)
                .order('occurred_at', { ascending: false })
                .limit(100);

            if (error || !data || data.length === 0) return;

            let cooldowns = {};
            try {
                cooldowns = JSON.parse(remember('analytics_error_cooldowns') || '{}');
            } catch {
                cooldowns = {};
            }

            const grouped = new Map();
            data.forEach((row) => {
                const message = (row.props && row.props.message) || 'unknown';
                const key = message.slice(0, 120);
                const entry = grouped.get(key) || { message: key, path: row.path, count: 0, last: row.occurred_at };
                entry.count += 1;
                if (new Date(row.occurred_at) > new Date(entry.last)) {
                    entry.last = row.occurred_at;
                    entry.path = row.path;
                }
                grouped.set(key, entry);
            });

            const fresh = [];
            grouped.forEach((entry, key) => {
                const lastAlert = cooldowns[key] || 0;
                if (now - lastAlert >= COOLDOWN_MS) {
                    fresh.push(entry);
                    cooldowns[key] = now;
                }
            });

            // فقط ۵۰ کلید آخر نگه داشته می‌شود
            const keys = Object.keys(cooldowns).sort((a, b) => cooldowns[b] - cooldowns[a]);
            const trimmed = {};
            keys.slice(0, 50).forEach((k) => { trimmed[k] = cooldowns[k]; });
            rememberSet('analytics_error_cooldowns', JSON.stringify(trimmed));

            if (fresh.length === 0) return;

            const lines = ['🚨 <b>خطای جدید در سایت!</b>', ''];
            fresh.slice(0, 5).forEach((e) => {
                lines.push(
                    `• <code>${esc(clip(e.message, 70))}</code>\n` +
                    `   ${faNum(e.count)} بار · ${esc(pageLabel(e.path))}\n` +
                    `   ${jalaliDateTime(e.last)}`
                );
            });
            if (fresh.length > 5) {
                lines.push(`\n<i>و ${faNum(fresh.length - 5)} خطای دیگر…</i>`);
            }
            lines.push('\nبرای جزئیات بزن /errors');

            const html = lines.join('\n');
            try {
                await bot.telegram.sendMessage(ownerId, html, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                });
            } catch {
                await bot.telegram.sendMessage(ownerId, toPlain(html));
            }
            console.log(`🚨 ${fresh.length} خطای جدید به تلگرام گزارش شد.`);
        } catch (err) {
            console.error('❌ خطا در پایش خطاهای سایت:', err.message);
        }
    };

    setInterval(tick, INTERVAL_MS);
    setTimeout(tick, 2 * 60 * 1000);
    console.log('🚨 هشدار خطاهای سایت فعال شد (هر ۱۰ دقیقه).');
}

module.exports = {
    getOverview,
    formatOverview,
    formatErrors,
    sendReport,
    startAnalyticsDigest,
    startErrorWatcher,
    toPlain,
    jalaliDateTime,
};
