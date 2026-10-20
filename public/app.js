/**
 * Hassan Agent - Telegram Mini App Logic
 * مدیریت تعاملات، فچ زنده دیتابیس، تب‌ها و ادغام با Telegram WebApp
 */
// تابع کمکی برای پیشگیری قطعی از حملات XSS
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// گرفتن initData تلگرام؛ اگر SDK لود نشده باشد از هش/کوئری آدرس هم تلاش می‌کند
function getInitData() {
    const fromSdk = window.Telegram?.WebApp?.initData || '';
    if (fromSdk) return fromSdk;

    try {
        const hash = window.location.hash ? window.location.hash.replace(/^#/, '') : '';
        const fromHash = new URLSearchParams(hash).get('tgWebAppData');
        if (fromHash) return fromHash;

        const fromQuery = new URLSearchParams(window.location.search).get('initData');
        if (fromQuery) return fromQuery;
    } catch (e) {}

    return '';
}

// رهگیری تمام درخواست‌های fetch جهت ضمیمه کردن احراز هویت، جلوگیری از کش و دور زدن صفحه ngrok
const _origFetch = window.fetch;
window.fetch = function(url, options) {
    options = options || {};
    let finalUrl = url;
    if (typeof url === 'string') {
        const sep = url.includes('?') ? '&' : '?';
        finalUrl = `${url}${sep}_t=${Date.now()}`;
    }
    options.headers = options.headers || {};

    const initData = getInitData();
    const adminToken = localStorage.getItem('hassan_admin_token') || new URLSearchParams(window.location.search).get('token') || '';

    const setHeader = (k, v) => {
        if (!v) return;
        if (options.headers instanceof Headers) {
            options.headers.set(k, v);
        } else {
            options.headers[k] = v;
        }
    };

    setHeader('ngrok-skip-browser-warning', 'true');
    setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    setHeader('Pragma', 'no-cache');
    if (initData) setHeader('x-telegram-init-data', initData);
    if (adminToken) setHeader('x-admin-token', adminToken);

    return _origFetch(finalUrl, options);
};

const tg = window.Telegram?.WebApp;

// وضعیت سراسری برنامه
const state = {
    users: [],
    stats: null,
    selectedUser: null,
    activeTab: 'tab-users',
    analyticsDays: 7,
    errorsDays: 7,
};

// اولیه‌سازی Telegram WebApp
if (tg) {
    tg.ready();
    tg.expand();
    // تنظیم رنگ هدر با تم تلگرام
    if (tg.setHeaderColor) tg.setHeaderColor('#0a0d14');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#0a0d14');

    // دریافت نام کاربر تلگرام
    const tgUser = tg.initDataUnsafe?.user;
    if (tgUser && tgUser.first_name) {
        const greetingEl = document.getElementById('userGreeting');
        if (greetingEl) {
            greetingEl.textContent = `سلام ${tgUser.first_name} عزیز خوش اومدی 👋`;
        }
    }
}

// ─── توابع کمکی ───

function triggerHaptic(type = 'light') {
    try {
        if (tg?.HapticFeedback) {
            if (type === 'success' || type === 'warning' || type === 'error') {
                tg.HapticFeedback.notificationOccurred(type);
            } else {
                tg.HapticFeedback.impactOccurred(type);
            }
        }
    } catch (e) {}
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    triggerHaptic(type === 'error' ? 'error' : 'success');

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function formatRelativeTime(dateString) {
    if (!dateString) return 'نامشخص';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('fa-IR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return dateString;
    }
}

function getInitials(name) {
    if (!name) return '👤';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

function formatUptime(seconds) {
    if (!seconds) return '---';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h} ساعت و ${m} دقیقه`;
    return `${m} دقیقه`;
}

// ─── ارتباط با API ها ───

async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        if (data.success && data.stats) {
            state.stats = data.stats;
            document.getElementById('statTotalUsers').textContent = data.stats.totalUsers.toLocaleString('fa-IR');
            document.getElementById('statDbStatus').textContent = data.stats.databaseStatus;
            document.getElementById('statUptime').textContent = formatUptime(data.stats.uptime);
            const sourceBadge = document.getElementById('sourceBadge');
            if (sourceBadge) sourceBadge.textContent = 'Supabase Auth';
        }
    } catch (err) {
        console.warn('Error fetching stats:', err);
    }
}

async function fetchUsers(searchQuery = '') {
    const container = document.getElementById('usersListContainer');
    try {
        const url = searchQuery ? `/api/users?q=${encodeURIComponent(searchQuery)}` : '/api/users?limit=30';
        const res = await fetch(url);
        const data = await res.json();

        if (data.success) {
            state.users = data.users || [];
            document.getElementById('userCount').textContent = state.users.length.toLocaleString('fa-IR');
            renderUsers(state.users);
        } else {
            container.innerHTML = `<div class="loading-state"><p>❌ خطا در دریافت کاربران: ${escapeHTML(data.error || 'ناشناخته')}</p></div>`;
        }
    } catch (err) {
        container.innerHTML = `<div class="loading-state"><p>❌ خطا در ارتباط با سرور: ${escapeHTML(err.message || '')}</p></div>`;
    }
}

function renderUsers(users) {
    const container = document.getElementById('usersListContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!users || users.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'loading-state';
        emptyDiv.innerHTML = '<span style="font-size: 32px;">🔍</span><p>هیچ کاربری با این مشخصات یافت نشد.</p>';
        container.appendChild(emptyDiv);
        return;
    }

    users.forEach(user => {
        const name = user.full_name || user.username || user.name || 'کاربر بدون نام';
        const email = user.email || 'ایمیل ثبت نشده';
        const id = user.id || user.site_user_id || '';
        const date = formatRelativeTime(user.created_at || user.registration_date);
        const initials = getInitials(name);

        const card = document.createElement('div');
        card.className = 'user-card';
        card.addEventListener('click', () => openUserModal(id));

        const left = document.createElement('div');
        left.className = 'user-info-left';

        const avatar = document.createElement('div');
        avatar.className = 'user-avatar';
        avatar.textContent = initials;

        const texts = document.createElement('div');
        texts.className = 'user-texts';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'user-name';
        nameSpan.textContent = name;

        const emailSpan = document.createElement('span');
        emailSpan.className = 'user-email';
        emailSpan.textContent = email;

        const dateSpan = document.createElement('span');
        dateSpan.className = 'user-date';
        dateSpan.textContent = `عضویت: ${date}`;

        texts.appendChild(nameSpan);
        texts.appendChild(emailSpan);
        texts.appendChild(dateSpan);

        left.appendChild(avatar);
        left.appendChild(texts);

        const arrow = document.createElement('div');
        arrow.className = 'user-arrow';
        arrow.textContent = '❯';

        card.appendChild(left);
        card.appendChild(arrow);

        container.appendChild(card);
    });
}

async function fetchCurrency() {
    const container = document.getElementById('currencyContainer');
    try {
        const res = await fetch('/api/currency');
        const data = await res.json();

        if (data.success && data.rates) {
            const timeEl = document.getElementById('currencyUpdatedTime');
            if (timeEl && data.updated) timeEl.textContent = `بروزرسانی: ${data.updated}`;

            container.innerHTML = Object.entries(data.rates).map(([name, price]) => `
                <div class="currency-card">
                    <span class="curr-name">${escapeHTML(name)}</span>
                    <span class="curr-val">${escapeHTML(price)}</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = `<div class="loading-state"><p>⚠️ خطا در استعلام قیمت‌ها</p></div>`;
        }
    } catch (err) {
        container.innerHTML = `<div class="loading-state"><p>❌ خطا در دریافت نرخ ارز: ${escapeHTML(err.message || '')}</p></div>`;
    }
}

// ─── Modal مدیریت کاربر ───

function formatProficiency(level) {
    const map = {
        'beginner': 'مبتدی 🌱',
        'elementary': 'مقدماتی 📘',
        'intermediate': 'متوسط ⚡',
        'upper-intermediate': 'نیمه‌حرفه‌ای 🎯',
        'advanced': 'پیشرفته 🏆',
        'native': 'مسلط / بومی 👑'
    };
    return map[String(level).toLowerCase()] || level || 'مبتدی 🌱';
}

window.openUserModal = async function(userId) {
    triggerHaptic('selection');
    const user = state.users.find(u => String(u.id || u.site_user_id) === String(userId));
    if (!user) return;

    state.selectedUser = user;
    const name = user.full_name || user.username || user.name || 'کاربر بدون نام';
    const email = user.email || 'بدون ایمیل';
    const initials = getInitials(name);
    const resolvedId = user.id || user.site_user_id;

    // ۱. پر کردن فیلدهای پایه
    const avatarEl = document.getElementById('modalAvatar');
    if (avatarEl) avatarEl.textContent = initials;
    
    document.getElementById('modalUserName').textContent = name;
    
    const subtitleEl = document.getElementById('modalUserSubtitle');
    if (subtitleEl) subtitleEl.textContent = user.username ? `@${user.username}` : email;

    document.getElementById('modalUserId').textContent = resolvedId;
    document.getElementById('modalUserEmail').textContent = email;
    document.getElementById('modalUserJoined').textContent = formatRelativeTime(user.created_at || user.registration_date);
    
    const lastActiveEl = document.getElementById('modalUserLastActive');
    if (lastActiveEl) {
        lastActiveEl.textContent = formatRelativeTime(user.last_activity || user.last_sign_in_at || user.created_at);
    }

    // ۲. ریست به حالت در حال بارگذاری
    document.getElementById('userXp').textContent = '...';
    document.getElementById('userStreak').textContent = '...';
    document.getElementById('userLevel').textContent = '...';
    document.getElementById('userSongs').textContent = '...';
    document.getElementById('userQuizzes').textContent = '...';
    document.getElementById('userLeitnerCount').textContent = '...';
    document.getElementById('leitnerCardCount').textContent = '...';
    
    const interestsContainer = document.getElementById('userInterestsContainer');
    if (interestsContainer) interestsContainer.innerHTML = '';

    const listEl = document.getElementById('modalLeitnerList');
    if (listEl) {
        listEl.innerHTML = `
            <div class="loading-state-small">
                <div class="spinner" style="width:20px;height:20px;margin:0 auto 8px;"></div>
                <p>در حال دریافت ریز جزئیات تسک‌ها و جعبه لایتنر...</p>
            </div>
        `;
    }
    
    document.getElementById('modalMsgText').value = '';
    document.getElementById('modalNoteText').value = user.notes || '';

    // نمایش فوری مودال
    document.getElementById('userModal').style.display = 'flex';

    // ریست ماموریت‌ها و دستاوردها به حالت لودینگ
    const missionsBadge = document.getElementById('dailyMissionsBadge');
    if (missionsBadge) missionsBadge.textContent = 'در حال استعلام...';
    
    const missionsListEl = document.getElementById('modalMissionsList');
    if (missionsListEl) {
        missionsListEl.innerHTML = `
            <div class="loading-state-small">
                <p>در حال دریافت ماموریت‌ها و تسک‌های روزانه...</p>
            </div>
        `;
    }

    const achWrapper = document.getElementById('modalAchievementsWrapper');
    const achListEl = document.getElementById('modalAchievementsList');
    if (achWrapper) achWrapper.style.display = 'none';
    if (achListEl) achListEl.innerHTML = '';

    // ۳. فراخوانی API جهت دریافت جزئیات پیشرفت، تسک‌ها و کارت‌های لایتنر
    try {
        const res = await fetch(`/api/users/${resolvedId}`);
        const data = await res.json();

        if (data.success) {
            const prog = data.progress || {};
            const cards = data.leitnerCards || [];
            const missions = data.dailyMissions || [];
            const achievements = data.achievements || [];
            const interests = prog.musicalInterests || [];

            // آمار و گیمیفیکیشن
            document.getElementById('userXp').textContent = (prog.xp || 0).toLocaleString('fa-IR');
            document.getElementById('userStreak').textContent = `${(prog.streakDays || 0).toLocaleString('fa-IR')} روز`;
            document.getElementById('userLevel').textContent = formatProficiency(prog.proficiencyLevel);
            document.getElementById('userSongs').textContent = (prog.songsCompleted || 0).toLocaleString('fa-IR');
            document.getElementById('userQuizzes').textContent = (prog.quizzesPassed || 0).toLocaleString('fa-IR');
            document.getElementById('userLeitnerCount').textContent = (prog.leitnerTotal || cards.length || 0).toLocaleString('fa-IR');

            // علایق و سبک‌ها
            if (interestsContainer) {
                if (Array.isArray(interests) && interests.length > 0) {
                    interestsContainer.innerHTML = interests.map(item => `
                        <span class="tag-badge">🎵 ${escapeHTML(item)}</span>
                    `).join('');
                } else {
                    interestsContainer.innerHTML = '';
                }
            }

            // ۱. رندر ماموریت‌ها و تسک‌های روزانه
            if (missionsListEl) {
                if (missions.length === 0) {
                    missionsListEl.innerHTML = `
                        <div class="empty-tasks-placeholder">
                            <p>📭 هیچ تسک یا ماموریت روزانه‌ای برای این کاربر ثبت نشده است.</p>
                        </div>
                    `;
                    if (missionsBadge) missionsBadge.textContent = '۰ ماموریت';
                } else {
                    const doneCount = missions.filter(m => m.completed).length;
                    if (missionsBadge) {
                        missionsBadge.textContent = `${doneCount.toLocaleString('fa-IR')} از ${missions.length.toLocaleString('fa-IR')} تکمیل`;
                    }
                    missionsListEl.innerHTML = missions.map(m => {
                        const percent = Math.min(100, Math.round(((m.currentProgress || 0) / (m.requirement || 1)) * 100));
                        const isDone = m.completed || percent >= 100;
                        const safeTitle = escapeHTML(m.title || 'ماموریت بدون عنوان');
                        const safeDesc = m.description ? `<div class="mission-desc">${escapeHTML(m.description)}</div>` : '';
                        return `
                            <div class="mission-card ${isDone ? 'completed' : ''}">
                                <div class="mission-top-row">
                                    <div class="mission-title-box">
                                        <span class="mission-emoji">${escapeHTML(m.emoji || '🎯')}</span>
                                        <span class="mission-name">${safeTitle}</span>
                                    </div>
                                    <span class="mission-reward">+${(m.xpReward || 10).toLocaleString('fa-IR')} XP ⭐</span>
                                </div>
                                ${safeDesc}
                                <div class="mission-progress-bar">
                                    <div class="mission-progress-fill ${isDone ? 'done' : ''}" style="width: ${percent}%;"></div>
                                </div>
                                <div class="mission-status-text">
                                    <span>پیشرفت: ${(m.currentProgress || 0).toLocaleString('fa-IR')} از ${(m.requirement || 1).toLocaleString('fa-IR')}</span>
                                    <span>${isDone ? '✅ تکمیل شده' : '⏳ در حال انجام'}</span>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

            // ۲. رندر واژگان و کارت‌های لایتنر
            document.getElementById('leitnerCardCount').textContent = `${cards.length.toLocaleString('fa-IR')} کلمه`;

            if (listEl) {
                if (cards.length === 0) {
                    listEl.innerHTML = `
                        <div class="empty-tasks-placeholder">
                            <p>📭 هنوز کلمه‌ای در جعبه لایتنر این کاربر قرار نگرفته است.</p>
                        </div>
                    `;
                } else {
                    listEl.innerHTML = cards.map(c => {
                        const boxNum = c.box || 1;
                        const word = escapeHTML(c.word || 'بدون واژه');
                        const translation = escapeHTML(c.translation || c.definition || '');
                        const example = escapeHTML(c.example || '');
                        const pos = c.part_of_speech ? `<span class="card-pos">${escapeHTML(c.part_of_speech)}</span>` : '';
                        const nextRev = c.next_review ? new Date(c.next_review).toLocaleDateString('fa-IR') : 'تعیین نشده';
                        const reviews = (c.review_count || 0).toLocaleString('fa-IR');
                        const corrects = (c.correct_count || 0).toLocaleString('fa-IR');

                        return `
                            <div class="leitner-card-item">
                                <div class="card-word-row">
                                    <div class="card-word-left">
                                        <span class="card-word">${word}</span>
                                        ${pos}
                                    </div>
                                    <span class="card-box-badge">جعبه ${boxNum} 📦</span>
                                </div>
                                ${translation ? `<div class="card-trans">${translation}</div>` : ''}
                                ${example ? `<div class="card-example">"${example}"</div>` : ''}
                                <div class="card-meta-row">
                                    <span>📅 مرور بعدی: ${nextRev}</span>
                                    <span>🎯 مرور: ${reviews} بار (${corrects} درست)</span>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

            // ۳. دستاوردها و مدال‌ها
            if (achWrapper && achListEl) {
                if (achievements.length > 0) {
                    achWrapper.style.display = 'block';
                    achListEl.innerHTML = achievements.map(a => `
                        <span class="achievement-badge" title="${escapeHTML(a.description || '')}">
                            ${escapeHTML(a.title || a.achievement_id || '')}
                        </span>
                    `).join('');
                } else {
                    achWrapper.style.display = 'none';
                }
            }

            // ۴. آهنگ‌ها و آزمون‌ها (Song Progress)
            const songsBadge = document.getElementById('modalSongsBadge');
            const songsListEl = document.getElementById('modalSongsList');
            const songProg = data.songProgress || [];
            if (songsBadge) songsBadge.textContent = `${songProg.length.toLocaleString('fa-IR')} آهنگ`;
            if (songsListEl) {
                if (songProg.length === 0) {
                    songsListEl.innerHTML = `
                        <div class="empty-tasks-placeholder">
                            <p>📭 هنوز آهنگی برای این کاربر ثبت نشده است.</p>
                        </div>
                    `;
                } else {
                    songsListEl.innerHTML = songProg.map(s => {
                        const score = s.quiz_score !== null && s.quiz_score !== undefined ? s.quiz_score : '---';
                        const songName = s.song_id ? escapeHTML(s.song_id.replace(/_/g, ' ').toUpperCase()) : 'آهنگ ناشناخته';
                        const date = s.completed_at ? new Date(s.completed_at).toLocaleDateString('fa-IR') : 'اخیراً';
                        return `
                            <div class="mission-card completed" style="margin-bottom:8px;">
                                <div class="mission-top-row">
                                    <div class="mission-title-box">
                                        <span class="mission-emoji">🎵</span>
                                        <span class="mission-name">${songName}</span>
                                    </div>
                                    <span class="card-box-badge">نمره کوییز: ${score}% 🎯</span>
                                </div>
                                <div class="card-meta-row" style="margin-top:6px;">
                                    <span>وضعیت: ✅ تکمیل شده</span>
                                    <span>📅 تاریخ: ${date}</span>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

            // یادداشت‌های ذخیره شده
            if (data.notes) {
                document.getElementById('modalNoteText').value = data.notes;
            }
        } else {
            if (listEl) {
                listEl.innerHTML = `
                    <div class="empty-tasks-placeholder">
                        <p>⚠️ خطا در بارگذاری جزئیات: ${escapeHTML(data.error || 'ناشناخته')}</p>
                    </div>
                `;
            }
        }
    } catch (err) {
        if (listEl) {
            listEl.innerHTML = `
                <div class="empty-tasks-placeholder">
                    <p>❌ خطای ارتباط با سرور: ${escapeHTML(err.message || '')}</p>
                </div>
            `;
        }
    }
};

function closeModal() {
    document.getElementById('userModal').style.display = 'none';
    state.selectedUser = null;
}

// ──────────────────────────────────────────────────
// آمار، خطاها و لیدربورد (تب‌های گرافیکی)
// ──────────────────────────────────────────────────

const fa = (n) => Number(n || 0).toLocaleString('fa-IR');

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

const SOURCE_LABELS = {
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
    'x.com': 'ایکس',
    'twitter.com': 'ایکس',
    'facebook.com': 'فیسبوک',
    'www.facebook.com': 'فیسبوک',
    'linkedin.com': 'لینکدین',
    'bing.com': 'بینگ',
    'www.bing.com': 'بینگ',
    'duckduckgo.com': 'داک‌داک‌گو',
};

const DEVICE_LABELS = { desktop: 'دسکتاپ', mobile: 'موبایل', tablet: 'تبلت', unknown: 'نامشخص' };
const DEVICE_COLORS = { desktop: '#6366f1', mobile: '#10b981', tablet: '#f59e0b', unknown: '#64748b' };

const FUNNEL_STEPS = [
    { key: 'signup_view', label: '👀 دیدن فرم ثبت‌نام' },
    { key: 'signup_submit', label: '📝 ارسال فرم' },
    { key: 'signup_success', label: '✅ ثبت‌نام موفق' },
    { key: 'login_success', label: '🔓 ورود موفق' },
];

function pageLabel(path) {
    if (!path) return 'نامشخص';
    if (PAGE_LABELS[path]) return PAGE_LABELS[path];
    if (path.startsWith('/song/')) return `آهنگ: ${path.slice(6)}`;
    return path;
}

function songLabel(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'بدون نام';
    if (raw.startsWith('/song/') || raw.startsWith('song/')) {
        return raw.replace(/^\/?song\//, '').replace(/\/+$/, '').replace(/[-_]+/g, ' ').trim();
    }
    return raw;
}

function sourceLabel(source) {
    if (!source) return 'نامشخص';
    return SOURCE_LABELS[source] || source;
}

function jalaliShort(value) {
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

function dayLabel(day) {
    try {
        return new Date(`${day}T12:00:00Z`).toLocaleDateString('fa-IR', {
            timeZone: 'UTC',
            day: 'numeric',
        });
    } catch {
        return day;
    }
}

function deltaMarkup(current, previous) {
    const now = Number(current) || 0;
    const before = Number(previous) || 0;
    if (before === 0) return now > 0 ? '<span class="kpi-delta up">جدید ✨</span>' : '';
    const diff = Math.round(((now - before) / before) * 100);
    if (diff === 0) return '<span class="kpi-delta">بی‌تغییر</span>';
    return `<span class="kpi-delta ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${fa(Math.abs(diff))}٪</span>`;
}

function kpiCard(icon, label, value, delta, color) {
    return `<div class="kpi-card" style="--kpi-color:${color}">
        <div class="kpi-top"><span>${icon}</span><span>${escapeHTML(label)}</span></div>
        <div class="kpi-value">${value}</div>
        ${delta ? `<div>${delta}</div>` : ''}
    </div>`;
}

function loadingBlock(text) {
    return `<div class="loading-state"><div class="spinner"></div><p>${escapeHTML(text)}</p></div>`;
}

function errorBlock(message) {
    return `<div class="loading-state"><p>❌ ${escapeHTML(message)}</p><p style="font-size:.72rem;">دکمهٔ بروزرسانی بالای صفحه را بزن.</p></div>`;
}

// ── آمار ──

async function loadAnalytics(days = state.analyticsDays) {
    state.analyticsDays = days;
    document.querySelectorAll('#analyticsRange .chip').forEach((chip) => {
        chip.classList.toggle('active', Number(chip.dataset.days) === Number(days));
    });

    const body = document.getElementById('analyticsBody');
    if (!body) return;
    body.innerHTML = loadingBlock('در حال دریافت آمار...');

    try {
        const res = await fetch(`/api/analytics?days=${days}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'خطای نامشخص');
        renderAnalytics(data);
    } catch (err) {
        body.innerHTML = errorBlock(err.message || 'خطا در ارتباط با سرور');
    }
}

function renderAnalytics(data) {
    const body = document.getElementById('analyticsBody');
    if (!body) return;

    const ov = data.overview || {};
    const totals = ov.totals || {};
    const prev = ov.previous || {};
    const site = ov.site || {};
    const daily = Array.isArray(ov.daily) ? ov.daily : [];
    const funnel = Array.isArray(ov.funnel) ? ov.funnel : [];
    const songs = Array.isArray(ov.top_songs) ? ov.top_songs : [];
    const paths = Array.isArray(ov.top_paths) ? ov.top_paths : [];
    const referrers = Array.isArray(ov.referrers) ? ov.referrers : [];
    const devices = Array.isArray(ov.devices) ? ov.devices : [];
    const reminders = data.reminders || ov.reminders || {};

    // نشانگر آنلاین
    const live = Number(site.live_now) || 0;
    const pill = document.getElementById('analyticsLive');
    const pillCount = document.getElementById('analyticsLiveCount');
    if (pill && pillCount) {
        pillCount.textContent = fa(live);
        pill.style.display = live > 0 ? 'inline-flex' : 'none';
    }

    const parts = [];

    // ── کارت‌های خلاصه
    parts.push(`<div class="kpi-grid">
        ${kpiCard('👣', 'بازدید صفحه', fa(totals.pageviews), deltaMarkup(totals.pageviews, prev.pageviews), '#6366f1')}
        ${kpiCard('🧑', 'بازدیدکننده یکتا', fa(totals.visitors), `<span class="kpi-delta">${fa(site.total_users)} کاربر کل</span>`, '#06b6d4')}
        ${kpiCard('✍️', 'ثبت‌نام جدید', fa(totals.signups), deltaMarkup(totals.signups, prev.signups), '#10b981')}
        ${kpiCard('🚨', 'خطاها', fa(totals.errors), deltaMarkup(totals.errors, prev.errors), '#f43f5e')}
    </div>`);

    // ── نمودار روزانه
    if (daily.length > 1) {
        const recent = daily.slice(-14);
        const values = recent.map((d) => Number(d.pageviews) || 0);
        const max = Math.max(...values, 1);
        const peakIdx = values.indexOf(Math.max(...values));

        const bars = recent.map((d, i) => {
            const pv = Number(d.pageviews) || 0;
            const h = Math.max(3, Math.round((pv / max) * 100));
            return `<div class="bar-col ${i === peakIdx ? 'peak' : ''}">
                <span class="bar-value">${pv > 0 ? fa(pv) : ''}</span>
                <div class="bar-track"><div class="bar-fill" style="--h:${h}%"></div></div>
                <span class="bar-label">${dayLabel(d.day)}</span>
            </div>`;
        }).join('');

        parts.push(`<div class="chart-card">
            <div class="card-head"><h3 class="card-title">📈 بازدید روزانه</h3><span class="card-hint">اوج: ${fa(max)}</span></div>
            <div class="chart-bars">${bars}</div>
        </div>`);
    }

    // ── قیف ثبت‌نام
    const funnelRows = FUNNEL_STEPS
        .map((step) => ({ ...step, count: Number((funnel.find((f) => f.event === step.key) || {}).sessions) || 0 }))
        .filter((row) => row.count > 0);

    if (funnelRows.length > 0) {
        const base = funnelRows[0].count || 1;
        parts.push(`<div class="chart-card">
            <div class="card-head"><h3 class="card-title">🔻 قیف ثبت‌نام</h3><span class="card-hint">${fa(base)} نفر شروع</span></div>
            <div class="funnel">
                ${funnelRows.map((row) => `<div class="funnel-row">
                    <div class="funnel-top"><span>${row.label}</span><b>${fa(row.count)}</b></div>
                    <div class="funnel-bar"><div class="funnel-fill" style="--w:${Math.max(4, Math.round((row.count / base) * 100))}%"></div></div>
                </div>`).join('')}
            </div>
        </div>`);
    }

    // ── آهنگ‌ها
    if (songs.length > 0) {
        const max = Math.max(...songs.map((s) => Number(s.opens) || 0), 1);
        parts.push(`<div class="chart-card">
            <div class="card-head"><h3 class="card-title">🎧 پرطرفدارترین آهنگ‌ها</h3><span class="card-hint">${fa(songs.length)} آهنگ</span></div>
            <div class="rank-list">
                ${songs.slice(0, 5).map((song, i) => {
                    const opens = Number(song.opens) || 0;
                    return `<div class="rank-item">
                        <span class="rank-pos">${fa(i + 1)}</span>
                        <div class="rank-main">
                            <div class="rank-name"><span class="n">${escapeHTML(songLabel(song.title))}</span><span class="c">${fa(opens)} بار</span></div>
                            <div class="rank-bar"><div class="rank-fill" style="--w:${Math.max(5, Math.round((opens / max) * 100))}%"></div></div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`);
    }

    // ── صفحه‌ها
    if (paths.length > 0) {
        const max = Math.max(...paths.map((p) => Number(p.views) || 0), 1);
        parts.push(`<div class="chart-card">
            <div class="card-head"><h3 class="card-title">📄 صفحه‌های پربازدید</h3></div>
            <div class="rank-list">
                ${paths.slice(0, 5).map((page, i) => {
                    const views = Number(page.views) || 0;
                    return `<div class="rank-item">
                        <span class="rank-pos">${fa(i + 1)}</span>
                        <div class="rank-main">
                            <div class="rank-name"><span class="n">${escapeHTML(pageLabel(page.path))}</span><span class="c">${fa(views)}</span></div>
                            <div class="rank-bar"><div class="rank-fill" style="--w:${Math.max(5, Math.round((views / max) * 100))}%"></div></div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`);
    }

    // ── منابع ورود
    if (referrers.length > 0) {
        const totalSessions = referrers.reduce((sum, r) => sum + (Number(r.sessions) || 0), 0) || 1;
        parts.push(`<div class="chart-card">
            <div class="card-head"><h3 class="card-title">🌐 منبع ورود</h3></div>
            <div class="chip-cloud">
                ${referrers.slice(0, 8).map((r) => {
                    const sessions = Number(r.sessions) || 0;
                    return `<span class="source-chip">${escapeHTML(sourceLabel(r.source))} <b>${fa(sessions)}</b> · ${fa(Math.round((sessions / totalSessions) * 100))}٪</span>`;
                }).join('')}
            </div>
        </div>`);
    }

    // ── دستگاه‌ها
    if (devices.length > 0) {
        const totalSessions = devices.reduce((sum, d) => sum + (Number(d.sessions) || 0), 0) || 1;
        parts.push(`<div class="chart-card">
            <div class="card-head"><h3 class="card-title">📱 دستگاه‌ها</h3></div>
            <div class="stack-bar">
                ${devices.map((d) => {
                    const sessions = Number(d.sessions) || 0;
                    const color = DEVICE_COLORS[d.device] || DEVICE_COLORS.unknown;
                    return `<div class="stack-seg" style="width:${Math.max(2, Math.round((sessions / totalSessions) * 100))}%;background:${color};"></div>`;
                }).join('')}
            </div>
            <div class="legend">
                ${devices.map((d) => {
                    const color = DEVICE_COLORS[d.device] || DEVICE_COLORS.unknown;
                    return `<span><i style="background:${color}"></i>${escapeHTML(DEVICE_LABELS[d.device] || d.device)} ${fa(d.sessions)}</span>`;
                }).join('')}
            </div>
        </div>`);
    }

    // ── یادآور روزانه
    const subscribers = Number(reminders.subscribers) || 0;
    const notified = Number(reminders.notified_today) || 0;
    parts.push(`<div class="chart-card">
        <div class="card-head"><h3 class="card-title">🔔 یادآور روزانه</h3><span class="card-hint">۱۹:۰۰ تهران</span></div>
        <div class="reminder-strip">
            ${subscribers > 0
                ? `<span>👤 <b>${fa(subscribers)}</b> نفر روشن کرده‌اند</span><span>·</span><span>امروز <b>${fa(notified)}</b> یادآوری رفت</span>`
                : '<span>هنوز کسی یادآور روزانه را روشن نکرده است.</span>'}
        </div>
    </div>`);

    body.innerHTML = parts.join('');
}

// ── خطاها ──

async function loadErrors(days = state.errorsDays) {
    state.errorsDays = days;
    document.querySelectorAll('#errorsRange .chip').forEach((chip) => {
        chip.classList.toggle('active', Number(chip.dataset.days) === Number(days));
    });

    const body = document.getElementById('errorsBody');
    if (!body) return;
    body.innerHTML = loadingBlock('در حال بررسی خطاها...');

    try {
        const res = await fetch(`/api/errors?days=${days}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'خطای نامشخص');
        renderErrors(data);
    } catch (err) {
        body.innerHTML = errorBlock(err.message || 'خطا در ارتباط با سرور');
    }
}

function renderErrors(data) {
    const body = document.getElementById('errorsBody');
    if (!body) return;

    const errors = Array.isArray(data.errors) ? data.errors : [];
    const total = Number(data.total) || errors.reduce((sum, e) => sum + (Number(e.total) || 0), 0);

    const badge = document.getElementById('errorsTotalBadge');
    if (badge) badge.textContent = total > 0 ? `${fa(total)} خطا` : '✅ پاک';

    if (errors.length === 0) {
        body.innerHTML = `<div class="empty-ok">
            <span class="big">✅</span>
            <b>هیچ خطایی ثبت نشده</b>
            <span>در این بازه کاربران خطایی ندیده‌اند.</span>
        </div>`;
        return;
    }

    const pages = new Set(errors.map((e) => e.path || '/')).size;

    const summary = `<div class="error-summary">
        <div class="mini"><b>${fa(total)}</b><span>کل خطاها</span></div>
        <div class="mini"><b>${fa(errors.length)}</b><span>نوع خطا</span></div>
        <div class="mini"><b>${fa(pages)}</b><span>صفحه درگیر</span></div>
    </div>`;

    const list = errors.map((e) => `<div class="error-card">
        <div class="error-msg">${escapeHTML(e.message || 'unknown')}</div>
        <div class="error-meta">
            <span class="error-count">${fa(e.total)} بار</span>
            <span>${escapeHTML(pageLabel(e.path))}</span>
        </div>
        <div class="error-meta"><span>آخرین مشاهده: ${jalaliShort(e.last_seen)}</span></div>
    </div>`).join('');

    body.innerHTML = `${summary}<div class="errors-list">${list}</div>`;
}

// ── لیدربورد ──

async function loadLeaderboard() {
    const body = document.getElementById('leaderboardBody');
    if (!body) return;
    body.innerHTML = loadingBlock('در حال دریافت لیدربورد...');

    try {
        const res = await fetch('/api/leaderboard?limit=20');
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'خطای نامشخص');
        renderLeaderboard(data);
    } catch (err) {
        body.innerHTML = errorBlock(err.message || 'خطا در ارتباط با سرور');
    }
}

function avatarMarkup(player) {
    const img = player.avatarUrl
        ? `<img src="${escapeHTML(player.avatarUrl)}" alt="" loading="lazy" onerror="this.remove()">`
        : '';
    return `<div class="lb-avatar">${escapeHTML(player.initials || '؟')}${img}</div>`;
}

function renderLeaderboard(data) {
    const body = document.getElementById('leaderboardBody');
    if (!body) return;

    const players = Array.isArray(data.players) ? data.players : [];
    const summary = data.summary || {};

    if (players.length === 0) {
        body.innerHTML = `<div class="empty-ok">
            <span class="big">🏆</span>
            <b>هنوز کسی امتیاز نگرفته</b>
            <span>اولین نفری باش که XP جمع می‌کند!</span>
        </div>`;
        return;
    }

    const [first, second, third, ...rest] = players;

    const summaryHtml = `<div class="lb-summary">
        <div class="mini"><b>${fa(summary.totalPlayers || players.length)}</b><span>بازیکن</span></div>
        <div class="mini"><b>${fa(summary.averageXp)}</b><span>میانگین XP</span></div>
        <div class="mini"><b>${fa(summary.topStreak)}</b><span>🔥 بهترین استریک</span></div>
    </div>`;

    const hero = `<div class="lb-hero">
        ${avatarMarkup(first)}
        <div class="lb-main">
            <span class="lb-name">🥇 ${escapeHTML(first.name)}</span>
            <span class="lb-sub">${escapeHTML(first.level)} · 🔥 ${fa(first.streakDays)} روز · 🎵 ${fa(first.songsCompleted)} آهنگ</span>
        </div>
        <div class="lb-xp"><b>${fa(first.xp)}</b><span>XP</span></div>
    </div>`;

    const runnerCard = (player, medal) => `<div class="lb-runner">
        ${avatarMarkup(player)}
        <div class="lb-main">
            <span class="lb-name">${medal} ${escapeHTML(player.name)}</span>
            <span class="lb-sub">${fa(player.xp)} XP</span>
        </div>
    </div>`;

    const runners = (second || third)
        ? `<div class="lb-runners">${second ? runnerCard(second, '🥈') : ''}${third ? runnerCard(third, '🥉') : ''}</div>`
        : '';

    const list = rest.length > 0
        ? `<div class="lb-list">${rest.map((player) => `<div class="lb-row">
            <span class="lb-rank">${fa(player.rank)}</span>
            ${avatarMarkup(player)}
            <div class="lb-info">
                <span class="lb-name">${escapeHTML(player.name)}</span>
                <div class="lb-progress"><i style="--w:${Math.max(4, Number(player.progress) || 4)}%"></i></div>
            </div>
            <span class="lb-xp-sm">${fa(player.xp)}</span>
        </div>`).join('')}</div>`
        : '';

    body.innerHTML = summaryHtml + hero + runners + list;

    const updatedEl = document.getElementById('leaderboardUpdatedAt');
    if (updatedEl) updatedEl.textContent = `بروزرسانی: ${new Date().toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' })}`;
}

// ── مدیریت تب‌ها ──

function activateTab(tabId) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (!btn) return;

    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
    const pane = document.getElementById(tabId);
    if (pane) pane.classList.add('active');

    state.activeTab = tabId;

    if (tabId === 'tab-analytics') loadAnalytics();
    else if (tabId === 'tab-errors') loadErrors();
    else if (tabId === 'tab-leaderboard') loadLeaderboard();
    else if (tabId === 'tab-currency') fetchCurrency();
}

// ─── Event Listeners ───

document.addEventListener('DOMContentLoaded', () => {
    // بارگذاری اولیه
    fetchStats();
    fetchUsers();

    // سوئیچ تب‌ها
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            triggerHaptic('selection');
            activateTab(btn.getAttribute('data-tab'));
        });
    });

    // بازه‌های زمانی تب آمار
    document.querySelectorAll('#analyticsRange .chip').forEach(chip => {
        chip.addEventListener('click', () => {
            triggerHaptic('light');
            loadAnalytics(Number(chip.dataset.days) || 7);
        });
    });

    // بازه‌های زمانی تب خطاها
    document.querySelectorAll('#errorsRange .chip').forEach(chip => {
        chip.addEventListener('click', () => {
            triggerHaptic('light');
            loadErrors(Number(chip.dataset.days) || 7);
        });
    });

    // لینک مستقیم به یک تب (مثلاً از دکمهٔ ربات: ?tab=analytics)
    const deepTab = (new URLSearchParams(window.location.search).get('tab') || '').toLowerCase();
    const DEEP_TABS = {
        users: 'tab-users',
        analytics: 'tab-analytics',
        errors: 'tab-errors',
        leaderboard: 'tab-leaderboard',
        currency: 'tab-currency',
        system: 'tab-system',
    };
    if (deepTab && DEEP_TABS[deepTab]) {
        activateTab(DEEP_TABS[deepTab]);
    }

    // جستجوی زنده با Debounce
    const searchInput = document.getElementById('userSearchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    let searchTimeout = null;

    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        clearBtn.style.display = val ? 'block' : 'none';

        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            fetchUsers(val);
        }, 300);
    });

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.style.display = 'none';
        fetchUsers();
    });

    // دکمه رفرش
    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.addEventListener('click', () => {
        triggerHaptic('medium');
        refreshBtn.style.transform = 'rotate(180deg)';
        setTimeout(() => refreshBtn.style.transform = 'none', 400);

        fetchStats();
        if (state.activeTab === 'tab-currency') {
            fetchCurrency();
        } else if (state.activeTab === 'tab-analytics') {
            loadAnalytics();
        } else if (state.activeTab === 'tab-errors') {
            loadErrors();
        } else if (state.activeTab === 'tab-leaderboard') {
            loadLeaderboard();
        } else {
            fetchUsers(searchInput.value.trim());
        }
        showToast('داده‌ها بروزرسانی شدند ✅');
    });

    // بستن مودال
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('userModal').addEventListener('click', (e) => {
        if (e.target.id === 'userModal') closeModal();
    });

    // ارسال پیام مستقیم به کاربر
    document.getElementById('sendMsgBtn').addEventListener('click', async () => {
        if (!state.selectedUser) return;
        const msg = document.getElementById('modalMsgText').value.trim();
        const type = document.getElementById('modalMsgType').value;

        if (!msg) {
            showToast('لطفاً متن پیام را وارد کنید', 'error');
            return;
        }

        try {
            const btn = document.getElementById('sendMsgBtn');
            btn.disabled = true;
            btn.textContent = 'در حال ارسال...';

            const res = await fetch(`/api/users/${state.selectedUser.id || state.selectedUser.site_user_id}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg, type })
            });
            const data = await res.json();

            btn.disabled = false;
            btn.textContent = 'ارسال پیام';

            if (data.success) {
                showToast('پیام با موفقیت برای کاربر ثبت شد! 🚀', 'success');
                document.getElementById('modalMsgText').value = '';
            } else {
                showToast(`خطا: ${data.error || 'ارسال ناموفق'}`, 'error');
            }
        } catch (err) {
            showToast(`خطا در ارتباط: ${err.message}`, 'error');
        }
    });

    // ذخیره یادداشت
    document.getElementById('saveNoteBtn').addEventListener('click', async () => {
        if (!state.selectedUser) return;
        const note = document.getElementById('modalNoteText').value.trim();

        if (!note) {
            showToast('لطفاً متن یادداشت را وارد کنید', 'error');
            return;
        }

        try {
            const res = await fetch(`/api/users/${state.selectedUser.id || state.selectedUser.site_user_id}/note`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note })
            });
            const data = await res.json();

            if (data.success) {
                showToast('یادداشت با موفقیت ذخیره شد 📝', 'success');
                document.getElementById('modalNoteText').value = '';
            } else {
                showToast(`خطا: ${data.error || 'ذخیره ناموفق'}`, 'error');
            }
        } catch (err) {
            showToast(`خطا در ارتباط: ${err.message}`, 'error');
        }
    });

    // کپی شناسه کاربر
    const copyIdBtn = document.getElementById('copyIdBtn');
    if (copyIdBtn) {
        copyIdBtn.addEventListener('click', () => {
            const idText = document.getElementById('modalUserId').textContent;
            if (idText && idText !== '---') {
                triggerHaptic('light');
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(idText).then(() => {
                        showToast('شناسه کاربر کپی شد 📋', 'success');
                    }).catch(() => {
                        showToast('شناسه: ' + idText);
                    });
                } else {
                    showToast('شناسه: ' + idText);
                }
            }
        });
    }
});
