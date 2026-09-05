import { supabase } from './supabase-client.js'; // 🟢 NEW: Database client for logging activity
import { CLOUDINARY_API_URL, CLOUDINARY_UPLOAD_PRESET, TICK_IMAGES, state } from './state.js';
import { renderDashboard } from './dashboard.js';
import { renderRewards, renderMyRewardsPage } from './store.js';
import { renderHistory } from './dashboard.js';
import { renderEcoPointsPage } from './store.js';
import { renderChallengesPage } from './challenges.js';
import { renderEventsPage } from './events.js'; 
import { renderProfile } from './dashboard.js';
import { showLeaderboardTab } from './social.js';

// DOM Cache
export const els = {
    get pages() { return document.querySelectorAll('.page'); },
    get sidebar() { return document.getElementById('sidebar'); },
    get sidebarOverlay() { return document.getElementById('sidebar-overlay'); },
    get userPointsHeader() { return document.getElementById('user-points-header'); },
    get userNameGreeting() { return document.getElementById('user-name-greeting'); },
    get dailyCheckinBtn() { return document.getElementById('daily-checkin-button'); },
    get lbPodium() { return document.getElementById('lb-podium-container'); },
    get lbList() { return document.getElementById('lb-list-container'); },
    get lbLeafLayer() { return document.getElementById('lb-leaf-layer'); },
    get productGrid() { return document.getElementById('product-grid'); },
    get storeSearch() { return document.getElementById('store-search-input'); },
    get storeSearchClear() { return document.getElementById('store-search-clear'); },
    get sortBy() { return document.getElementById('sort-by-select'); },
    get challengesList() { return document.getElementById('challenges-page-list'); },
    get eventsList() { return document.getElementById('event-list'); },
    get allRewardsList() { return document.getElementById('all-rewards-list'); },
    get historyList() { return document.getElementById('history-list'); },
    get storeDetailPage() { return document.getElementById('store-detail-page'); },
    get productDetailPage() { return document.getElementById('product-detail-page'); },
    get departmentDetailPage() { return document.getElementById('department-detail-page'); },
    get purchaseModalOverlay() { return document.getElementById('purchase-modal-overlay'); },
    get purchaseModal() { return document.getElementById('purchase-modal'); },
    get qrModalOverlay() { return document.getElementById('qr-modal-overlay'); },
    get qrModal() { return document.getElementById('qr-modal'); }
};

export const getPlaceholderImage = (size = '400x300', text = 'EcoCampus') => `https://placehold.co/${size}/EBFBEE/166534?text=${text}&font=inter`;

export const getTickImg = (tickType) => {
    if (!tickType) return '';
    const url = TICK_IMAGES[tickType.toLowerCase()];
    return url ? `<img src="${url}" class="tick-icon" alt="${tickType} tick">` : '';
};

export const getUserLevel = (points) => {
    let current = state.levels[0];
    for (let i = state.levels.length - 1; i >= 0; i--) {
        if (points >= state.levels[i].minPoints) {
            current = state.levels[i];
            break;
        }
    }
    const nextMin = current.nextMin || Infinity;
    let progress = 0;
    let progressText = "Max Level";
    if (nextMin !== Infinity) {
        const pointsInLevel = points - current.minPoints;
        const range = nextMin - current.minPoints;
        progress = Math.max(0, Math.min(100, (pointsInLevel / range) * 100));
        progressText = `${points} / ${nextMin} Pts`;
    }
    return { ...current, progress, progressText };
};

// --- NEW: IST DATE LOGIC ---

// 1. Get Today's Date string (YYYY-MM-DD) specifically for IST
export const getTodayIST = () => {
    // 'en-CA' format is always YYYY-MM-DD
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
};

// 2. Format any date string to show in IST
export const formatDate = (dateString, options = {}) => {
    if (!dateString) return '...';
    const defaultOptions = { 
        year: 'numeric', month: 'short', day: 'numeric',
        timeZone: 'Asia/Kolkata' // FORCE IST
    };
    const finalOptions = { ...defaultOptions, ...options };
    return new Date(dateString).toLocaleDateString('en-IN', finalOptions);
};

// ---------------------------

export const getIconForHistory = (type) => {
    const icons = { 'checkin': 'calendar-check', 'event': 'calendar-check', 'challenge': 'award', 'plastic': 'recycle', 'order': 'shopping-cart', 'coupon': 'ticket', 'quiz': 'brain' };
    return icons[type] || 'help-circle';
};

export const getIconForChallenge = (type) => {
    const icons = { 'Quiz': 'brain', 'Upload': 'camera', 'selfie': 'camera', 'spot': 'eye' };
    return icons[type] || 'award';
};

export const getUserInitials = (fullName) => {
    if (!fullName) return '..';
    return fullName.split(' ').map(n => n[0]).join('').toUpperCase();
};

export const uploadToCloudinary = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    
    try {
        const res = await fetch(CLOUDINARY_API_URL, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        return data.secure_url;
    } catch (err) { console.error("Cloudinary Upload Error:", err); throw err; }
};

export const showPage = (pageId, addToHistory = true) => {
    els.pages.forEach(p => p.classList.remove('active'));
    
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.add('active');

    if (!['store-detail-page', 'product-detail-page'].includes(pageId)) {
        els.storeDetailPage.innerHTML = ''; els.productDetailPage.innerHTML = '';
    }
    if (pageId !== 'department-detail-page') els.departmentDetailPage.innerHTML = '';

    document.querySelectorAll('.nav-item, .sidebar-nav-item').forEach(btn => {
        const onclickVal = btn.getAttribute('onclick');
        btn.classList.toggle('active', onclickVal && onclickVal.includes(`'${pageId}'`));
    });

    document.querySelector('.main-content').scrollTop = 0;

    if (addToHistory) {
        window.history.pushState({ pageId: pageId }, '', `#${pageId}`);
    }

    if (pageId === 'dashboard') { if(els.lbLeafLayer) els.lbLeafLayer.classList.add('hidden'); renderDashboard(); } 
    else if (pageId === 'leaderboard') { showLeaderboardTab('student'); } 
    else if (pageId === 'rewards') { if(els.lbLeafLayer) els.lbLeafLayer.classList.add('hidden'); window.renderRewardsWrapper && window.renderRewardsWrapper(); } 
    else if (pageId === 'my-rewards') { if(els.lbLeafLayer) els.lbLeafLayer.classList.add('hidden'); window.renderMyRewardsPageWrapper && window.renderMyRewardsPageWrapper(); } 
    else if (pageId === 'history') { if(els.lbLeafLayer) els.lbLeafLayer.classList.add('hidden'); renderHistory(); } 
    else if (pageId === 'ecopoints') { if(els.lbLeafLayer) els.lbLeafLayer.classList.add('hidden'); window.renderEcoPointsPageWrapper && window.renderEcoPointsPageWrapper(); } 
    else if (pageId === 'challenges') { if(els.lbLeafLayer) els.lbLeafLayer.classList.add('hidden'); window.renderChallengesPageWrapper && window.renderChallengesPageWrapper(); } 
    else if (pageId === 'events') { if(els.lbLeafLayer) els.lbLeafLayer.classList.add('hidden'); window.renderEventsPageWrapper && window.renderEventsPageWrapper(); } 
    else if (pageId === 'profile') { if(els.lbLeafLayer) els.lbLeafLayer.classList.add('hidden'); renderProfile(); }
    else { if(els.lbLeafLayer) els.lbLeafLayer.classList.add('hidden'); }

    toggleSidebar(true); 
    if(window.lucide) window.lucide.createIcons();
};

window.addEventListener('popstate', (event) => {
    if (event.state && event.state.pageId) {
        showPage(event.state.pageId, false);
    } else {
        showPage('dashboard', false); 
    }
});

export const toggleSidebar = (forceClose = false) => {
    if (forceClose) {
        els.sidebar.classList.add('-translate-x-full');
        els.sidebarOverlay.classList.add('opacity-0');
        els.sidebarOverlay.classList.add('hidden');
    } else {
        els.sidebar.classList.toggle('-translate-x-full');
        els.sidebarOverlay.classList.toggle('hidden');
        els.sidebarOverlay.classList.toggle('opacity-0');
    }
};

// --- MISSING UTILITIES FOR APP.JS ---

// 1. Debounce (Prevents spam-calling search functions)
export const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// 2. Show Toast (On-screen notifications)
export const showToast = (message, type = 'success') => {
    const toast = document.createElement('div');
    const bgColor = type === 'error' ? 'bg-red-500' : type === 'warning' ? 'bg-orange-500' : 'bg-green-500';
    toast.className = `fixed top-4 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-full text-white text-sm font-bold shadow-2xl z-[100] transition-all duration-300 opacity-0 -translate-y-5 ${bgColor}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', '-translate-y-5');
        toast.classList.add('opacity-100', 'translate-y-0');
    });

    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', '-translate-y-5');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// 3. Log User Activity (Saves actions to the database)
export const logUserActivity = async (actionType, description) => {
    if (!state.currentUser) return;
    try {
        await supabase.from('user_activity_log').insert({
            user_id: state.currentUser.id,
            action_type: actionType,
            description: description
        });
    } catch (err) {
        console.error('Activity Log Error:', err);
    }
};

window.showPage = showPage;
window.toggleSidebar = toggleSidebar;
