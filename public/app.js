/**
 * Hassan Agent - Telegram Mini App Logic
 * مدیریت تعاملات، فچ زنده دیتابیس، تب‌ها و ادغام با Telegram WebApp
 */
// Intercept all fetch requests to automatically bypass ngrok warning page and avoid caching
const _origFetch = window.fetch;
window.fetch = function(url, options) {
    options = options || {};
    let finalUrl = url;
    if (typeof url === 'string') {
        const sep = url.includes('?') ? '&' : '?';
        finalUrl = `${url}${sep}_t=${Date.now()}`;
    }
    options.headers = options.headers || {};
    if (options.headers instanceof Headers) {
        options.headers.set('ngrok-skip-browser-warning', 'true');
        options.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        options.headers.set('Pragma', 'no-cache');
    } else {
        options.headers['ngrok-skip-browser-warning'] = 'true';
        options.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        options.headers['Pragma'] = 'no-cache';
    }
    return _origFetch(finalUrl, options);
};

const tg = window.Telegram?.WebApp;

// وضعیت سراسری برنامه
const state = {
    users: [],
    stats: null,
    selectedUser: null,
    activeTab: 'tab-users',
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
            container.innerHTML = `<div class="loading-state"><p>❌ خطا در دریافت کاربران: ${data.error || 'ناشناخته'}</p></div>`;
        }
    } catch (err) {
        container.innerHTML = `<div class="loading-state"><p>❌ خطا در ارتباط با سرور: ${err.message}</p></div>`;
    }
}

function renderUsers(users) {
    const container = document.getElementById('usersListContainer');
    if (!users || users.length === 0) {
        container.innerHTML = `
            <div class="loading-state">
                <span style="font-size: 32px;">🔍</span>
                <p>هیچ کاربری با این مشخصات یافت نشد.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = users.map(user => {
        const name = user.full_name || user.username || user.name || 'کاربر بدون نام';
        const email = user.email || 'ایمیل ثبت نشده';
        const id = user.id || user.site_user_id || '---';
        const date = formatRelativeTime(user.created_at || user.registration_date);
        const initials = getInitials(name);

        return `
            <div class="user-card" onclick="openUserModal('${id}')">
                <div class="user-info-left">
                    <div class="user-avatar">${initials}</div>
                    <div class="user-texts">
                        <span class="user-name">${name}</span>
                        <span class="user-email">${email}</span>
                        <span class="user-date">عضویت: ${date}</span>
                    </div>
                </div>
                <div class="user-arrow">❯</div>
            </div>
        `;
    }).join('');
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
                    <span class="curr-name">${name}</span>
                    <span class="curr-val">${price}</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = `<div class="loading-state"><p>⚠️ خطا در استعلام قیمت‌ها</p></div>`;
        }
    } catch (err) {
        container.innerHTML = `<div class="loading-state"><p>❌ خطا در دریافت نرخ ارز: ${err.message}</p></div>`;
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
                        <span class="tag-badge">🎵 ${item}</span>
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
                        return `
                            <div class="mission-card ${isDone ? 'completed' : ''}">
                                <div class="mission-top-row">
                                    <div class="mission-title-box">
                                        <span class="mission-emoji">${m.emoji || '🎯'}</span>
                                        <span class="mission-name">${m.title}</span>
                                    </div>
                                    <span class="mission-reward">+${(m.xpReward || 10).toLocaleString('fa-IR')} XP ⭐</span>
                                </div>
                                ${m.description ? `<div class="mission-desc">${m.description}</div>` : ''}
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
                        const word = c.word || 'بدون واژه';
                        const translation = c.translation || c.definition || '';
                        const example = c.example || '';
                        const pos = c.part_of_speech ? `<span class="card-pos">${c.part_of_speech}</span>` : '';
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
                        <span class="achievement-badge" title="${a.description || ''}">
                            ${a.title || a.achievement_id}
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
                        const songName = s.song_id ? s.song_id.replace(/_/g, ' ').toUpperCase() : 'آهنگ ناشناخته';
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
                        <p>⚠️ خطا در بارگذاری جزئیات: ${data.error || 'ناشناخته'}</p>
                    </div>
                `;
            }
        }
    } catch (err) {
        if (listEl) {
            listEl.innerHTML = `
                <div class="empty-tasks-placeholder">
                    <p>❌ خطای ارتباط با سرور: ${err.message}</p>
                </div>
            `;
        }
    }
};

function closeModal() {
    document.getElementById('userModal').style.display = 'none';
    state.selectedUser = null;
}

// ─── Event Listeners ───

document.addEventListener('DOMContentLoaded', () => {
    // بارگذاری اولیه
    fetchStats();
    fetchUsers();

    // سوئیچ تب‌ها
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            triggerHaptic('selection');
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const tabId = btn.getAttribute('data-tab');
            state.activeTab = tabId;

            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            const targetPane = document.getElementById(tabId);
            if (targetPane) targetPane.classList.add('active');

            if (tabId === 'tab-currency') fetchCurrency();
        });
    });

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
