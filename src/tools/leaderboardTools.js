/**
 * Leaderboard Tools - جدول امتیازات LyricBaz
 *
 * داده‌ها مستقیم از جدول `profiles` در Supabase خوانده می‌شوند (با کلید
 * service_role) و هم در مینی‌اپ و هم در پیام تلگرام استفاده می‌شوند.
 * هیچ توکن هوش مصنوعی مصرف نمی‌شود.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

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
    console.warn('⚠️ اتصال Supabase برای لیدربورد برقرار نشد:', err.message);
}

const LEVEL_LABELS = {
    beginner: 'مبتدی',
    elementary: 'مقدماتی',
    intermediate: 'متوسط',
    'upper-intermediate': 'نیمه‌حرفه‌ای',
    advanced: 'پیشرفته',
    native: 'مسلط',
};

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function displayName(row) {
    const full = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    if (full) return full;
    if (row.username) return row.username;
    return 'کاربر بی‌نام';
}

function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(name || '؟').slice(0, 2).toUpperCase();
}

/**
 * ۲۰ نفر برتر بر اساس XP
 * @param {{ limit?: number }} options
 */
async function getLeaderboard({ limit = 20 } = {}) {
    if (!supabase) {
        return { success: false, error: 'اتصال Supabase تنظیم نشده (SITE_API_URL / SITE_API_KEY).' };
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);

    try {
        const { data, error, count } = await supabase
            .from('profiles')
            .select(
                'id, username, first_name, last_name, avatar_url, xp, streak_days, songs_completed, quizzes_passed, words_learned, proficiency_level',
                { count: 'exact' }
            )
            .gt('xp', 0)
            .order('xp', { ascending: false })
            .order('streak_days', { ascending: false })
            .limit(safeLimit);

        if (error) return { success: false, error: error.message };

        const rows = Array.isArray(data) ? data : [];
        const topXp = rows.length > 0 ? Number(rows[0].xp) || 1 : 1;

        const players = rows.map((row, index) => {
            const name = displayName(row);
            return {
                rank: index + 1,
                id: row.id,
                name,
                username: row.username || '',
                avatarUrl: row.avatar_url || '',
                initials: initialsOf(name),
                xp: Number(row.xp) || 0,
                streakDays: Number(row.streak_days) || 0,
                songsCompleted: Number(row.songs_completed) || 0,
                quizzesPassed: Number(row.quizzes_passed) || 0,
                wordsLearned: Number(row.words_learned) || 0,
                level: LEVEL_LABELS[row.proficiency_level] || 'مبتدی',
                levelKey: row.proficiency_level || 'beginner',
                progress: Math.max(4, Math.round(((Number(row.xp) || 0) / topXp) * 100)),
            };
        });

        const totalPlayers = Number(count) || players.length;
        const totalXp = players.reduce((sum, p) => sum + p.xp, 0);

        return {
            success: true,
            players,
            summary: {
                totalPlayers,
                topXp: players[0]?.xp || 0,
                averageXp: players.length > 0 ? Math.round(totalXp / players.length) : 0,
                topStreak: players.reduce((max, p) => Math.max(max, p.streakDays), 0),
            },
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

const MEDALS = ['🥇', '🥈', '🥉'];

/** گزارش متنی لیدربورد برای تلگرام (HTML) */
function formatLeaderboard(data, limit = 10) {
    if (!data || !data.success) {
        return `❌ لیدربورد در دسترس نیست.\n${esc(data?.error || 'خطای ناشناخته')}`;
    }

    const players = Array.isArray(data.players) ? data.players : [];
    const summary = data.summary || {};

    if (players.length === 0) {
        return '🏆 <b>لیدربورد LyricBaz</b>\n\nهنوز کسی امتیاز کسب نکرده — اولین نفر باش! 🎵';
    }

    const lines = ['🏆 <b>لیدربورد LyricBaz — برترین‌ها</b>'];
    lines.push(
        `👥 ${faNum(summary.totalPlayers)} بازیکن · ⚡ میانگین ${faNum(summary.averageXp)} XP · 🔥 بهترین استریک ${faNum(summary.topStreak)} روز`
    );
    lines.push('');

    players.slice(0, limit).forEach((p, i) => {
        const medal = MEDALS[i] || `${faNum(i + 1)}.`;
        const streak = p.streakDays > 0 ? ` · 🔥 ${faNum(p.streakDays)}` : '';
        lines.push(`${medal} <b>${esc(p.name)}</b> — ${faNum(p.xp)} XP${streak}`);
    });

    if (players.length > limit) {
        lines.push(`\n<i>و ${faNum(players.length - limit)} نفر دیگر…</i>`);
    }

    lines.push('\n📱 برای جدول گرافیکی، داشبورد را باز کن.');
    return lines.join('\n');
}

module.exports = {
    getLeaderboard,
    formatLeaderboard,
    LEVEL_LABELS,
};
