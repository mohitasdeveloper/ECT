/**
 * EcoCampus - Main Application Logic (app.js)
 * Final Version: Dual-Project Architecture with Light Theme Default
 */

import { authClient } from './auth-client.js';     
import { supabase } from './supabase-client.js';   
import { state } from './state.js';
import { els, toggleSidebar, showPage, logUserActivity, debounce, showToast } from './utils.js';
import { loadDashboardData, renderDashboard, setupFileUploads } from './dashboard.js';
import { loadEventsData } from './events.js'; 

// --- AUTHENTICATION CHECK & STARTUP ---

const checkAuth = async () => {
    try {
        const { data: { session }, error } = await authClient.auth.getSession();
        
        if (error) { 
            console.error('Auth Check: Session Error:', error.message); 
            showToast('Authentication error. Please log in again.', 'error');
            redirectToLogin(); 
            return; 
        }

        if (!session) { 
            console.warn('Auth Check: No active session found.');
            redirectToLogin(); 
            return; 
        }

        state.userAuth = session.user;
        await initializeApp();
    } catch (err) { 
        console.error('CRITICAL: Auth check failed unexpectedly:', err); 
        showToast('System error. Please refresh the page.', 'error');
        const loader = document.getElementById('app-loading');
        if(loader) loader.style.display = 'none';
    }
};

const initializeApp = async () => {
    try {
        console.log('Init: Fetching user profile...');
        console.log("%c🌿 EcoCampus Loaded.", "color: #fbbf24; font-size: 16px; font-weight: bold; background: #064e3b; padding: 5px; border-radius: 5px;");

        const { data: userProfile, error } = await supabase
            .from('users')
            .select('id, full_name, student_id, course, current_points, lifetime_points, profile_img_url, tick_type')
            .eq('auth_user_id', state.userAuth.id)
            .single();
        
        if (error || !userProfile) {
            console.error('Init: Failed to fetch user profile:', error?.message);
            alert(`DATABASE ERROR:\nCould not find user in EcoVities DB.\n\nLooking for auth_user_id:\n${state.userAuth.id}\n\nPlease check your Supabase "users" table to ensure this ID is pasted correctly.`);
            const loader = document.getElementById('app-loading');
            if(loader) loader.style.display = 'none';
            return; 
        }
        
        state.currentUser = userProfile;
        
        if (!sessionStorage.getItem('login_logged')) {
            logUserActivity('login', 'User logged in');
            sessionStorage.setItem('login_logged', '1');
            showToast(`Welcome back, ${userProfile.full_name}!`, 'success');
        }

        history.replaceState({ pageId: 'dashboard' }, '', '#dashboard');

        // --- LOAD DATA ---
        try {
            if (!state.dashboardLoaded) {
                await loadDashboardData();
                state.dashboardLoaded = true;
            }
            renderDashboard();

            loadEventsData().then(() => {
                console.log("Init: Events loaded.");
            });

        } catch (dashErr) {
            console.error("Init: Data load failed:", dashErr);
            showToast('Partial data load failure.', 'warning');
        }
        
        setupFileUploads();

    } catch (err) { 
        console.error('CRITICAL: App initialization crashed:', err);
        showToast('App failed to initialize.', 'error');
    } finally {
        setTimeout(() => {
            const loader = document.getElementById('app-loading');
            if (loader) {
                loader.classList.add('loaded');
                setTimeout(() => { loader.style.display = 'none'; }, 300);
            }
        }, 500);

        if(window.lucide) window.lucide.createIcons();
    }
};

const handleLogout = async () => {
    try {
        console.log('Logout: Initiating...');
        
        if (sessionStorage.getItem('login_logged')) {
            logUserActivity('logout', 'User logged out');
            sessionStorage.removeItem('login_logged');
        }
        
        const { error } = await authClient.auth.signOut();
        if (error) console.error('Logout: Error:', error.message);
        
        redirectToLogin();
    } catch (err) { 
        console.error('Logout: Critical error:', err);
        redirectToLogin(); 
    }
};

const redirectToLogin = () => { window.location.replace('login.html'); };

export const refreshUserData = async () => {
    try {
        const { data: userProfile, error } = await supabase
            .from('users')
            .select('id, current_points, lifetime_points, profile_img_url, tick_type')
            .eq('id', state.currentUser.id)
            .single();

        if (error) {
            console.error('RefreshData: Error:', error.message);
            return;
        }
        
        if (!userProfile) return;
        
        state.currentUser = { ...state.currentUser, ...userProfile };

        const header = document.getElementById('user-points-header');
        if(header) {
            header.classList.add('points-pulse');
            header.textContent = userProfile.current_points;
        }
        
        const sidebarPoints = document.getElementById('user-points-sidebar');
        if(sidebarPoints) sidebarPoints.textContent = userProfile.current_points;
        
        setTimeout(() => header?.classList.remove('points-pulse'), 400);
        renderDashboard();
    } catch (err) { 
        console.error('RefreshData: Unexpected error:', err); 
    }
};

// --- EVENT LISTENERS & UI LOGIC ---

if(els.storeSearch) {
    els.storeSearch.addEventListener('input', debounce(() => {
        if (state.storeLoaded && window.renderRewardsWrapper) window.renderRewardsWrapper();
    }, 300));
}

if(els.storeSearchClear) {
    els.storeSearchClear.addEventListener('click', () => { 
        els.storeSearch.value = ''; 
        if (state.storeLoaded && window.renderRewardsWrapper) window.renderRewardsWrapper(); 
    });
}

if(els.sortBy) {
    els.sortBy.addEventListener('change', () => {
        if (state.storeLoaded && window.renderRewardsWrapper) window.renderRewardsWrapper();
    });
}

document.getElementById('sidebar-toggle-btn')?.addEventListener('click', () => toggleSidebar());
document.getElementById('logout-button')?.addEventListener('click', handleLogout);

// --- 🟢 FIX: THEME MANAGEMENT (DEFAULT TO LIGHT) ---

const themeBtn = document.getElementById('theme-toggle-btn');
const themeText = document.getElementById('theme-text');
const themeIcon = document.getElementById('theme-icon');

const applyTheme = (isDark) => {
    try {
        document.documentElement.classList.toggle('dark', isDark);
        if(themeText) themeText.textContent = isDark ? 'Dark Mode' : 'Light Mode';
        if(themeIcon) themeIcon.setAttribute('data-lucide', isDark ? 'moon' : 'sun');
        if(window.lucide) window.lucide.createIcons();
    } catch (e) { console.error('Theme Apply Error:', e); }
};

if (themeBtn) {
    themeBtn.addEventListener('click', () => {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('eco-theme', isDark ? 'dark' : 'light');
        applyTheme(isDark);
        logUserActivity('theme_change', `Switched to ${isDark ? 'dark' : 'light'} mode`);
    });
}

// 🟢 ONLY use dark mode if it was explicitly saved in localStorage. Do not check system preferences.
const savedTheme = localStorage.getItem('eco-theme');
applyTheme(savedTheme === 'dark');

// --- ACCOUNT SECURITY: CHANGE PASSWORD ---

const changePwdForm = document.getElementById('change-password-form');
if (changePwdForm) {
    changePwdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const passwordInput = document.getElementById('new-password');
        const newPassword = passwordInput.value;
        const btn = document.getElementById('change-password-button');

        if (newPassword.length < 6) {
             showToast('Password must be at least 6 characters.', 'error');
             return;
        }

        btn.disabled = true;
        btn.textContent = 'Updating...';

        try {
            const { error } = await authClient.auth.updateUser({ password: newPassword });
            if (error) throw error;

            const { error: tableError } = await supabase
                .from('users')
                .update({ password_plain: newPassword })
                .eq('id', state.currentUser.id);

            if (tableError) throw tableError;

            showToast('Password updated successfully!', 'success');
            passwordInput.value = ''; 
            logUserActivity('password_change', 'User changed password');

        } catch (err) {
            console.error('Password Change Error:', err);
            showToast(err.message || 'Failed to update password.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Update Password';
        }
    });
}

// --- BONUS POINTS: REDEEM CODE ---

const redeemForm = document.getElementById('redeem-code-form');
if (redeemForm) {
    redeemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const codeInput = document.getElementById('redeem-input');
        const code = codeInput.value.trim();
        const btn = document.getElementById('redeem-submit-btn');
        
        btn.disabled = true; 
        btn.innerText = 'Verifying...'; 

        try {
            const { data, error } = await supabase.rpc('redeem_coupon', { p_code: code });
            
            if (error) throw error;
            
            showToast(`Success! You earned ${data.points_awarded} points.`, 'success');
            codeInput.value = ''; 
            
            logUserActivity('redeem_code_success', `Redeemed code: ${code}`);
            await refreshUserData(); 
            
        } catch (err) { 
            console.error("Redeem Code Error:", err);
            showToast(err.message || "Invalid or expired code.", "error");
            logUserActivity('redeem_code_fail', `Failed to redeem code: ${code}`);
        } finally { 
            btn.disabled = false; 
            btn.innerText = 'Redeem Points';
        }
    });
}

// --- START APP ---
window.handleLogout = handleLogout;
checkAuth();
