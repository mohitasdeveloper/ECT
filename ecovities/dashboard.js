import { supabase } from './supabase-client.js';
import { state } from './state.js';
import { els, formatDate, getIconForHistory, getPlaceholderImage, getTickImg, getUserInitials, getUserLevel, uploadToCloudinary, getTodayIST } from './utils.js';
import { refreshUserData } from './app.js';

export const loadDashboardData = async () => {
    try {
        const userId = state.currentUser.id;
        const today = getTodayIST(); 

        const [
            { data: checkinData },
            { data: streakData },
            { data: impactData }
        ] = await Promise.all([
            supabase.from('daily_checkins').select('id').eq('user_id', userId).eq('checkin_date', today).limit(1),
            // 🟢 FIX: Changed .single() to .maybeSingle() to prevent 406 errors on empty tables
            supabase.from('user_streaks').select('current_streak').eq('user_id', userId).maybeSingle(),
            supabase.from('user_impact').select('*').eq('user_id', userId).maybeSingle()
        ]);
        
        state.currentUser.isCheckedInToday = (checkinData && checkinData.length > 0);
        state.currentUser.checkInStreak = streakData ? streakData.current_streak : 0;
        state.currentUser.impact = impactData || { total_plastic_kg: 0, co2_saved_kg: 0, events_attended: 0 };
        
    } catch (err) {
        console.error('Dashboard Data Error:', err);
    }
};

export const renderDashboard = () => {
    if (!state.currentUser) return; 
    renderDashboardUI();
    renderCheckinButtonState();
};

const renderDashboardUI = () => {
    const user = state.currentUser;
    els.userPointsHeader.textContent = user.current_points;
    els.userNameGreeting.textContent = user.full_name;
    
    const sidebarName = document.getElementById('user-name-sidebar');
    if (sidebarName) sidebarName.innerHTML = `${user.full_name} ${getTickImg(user.tick_type)}`;
    
    const sidebarPoints = document.getElementById('user-points-sidebar');
    if (sidebarPoints) sidebarPoints.textContent = user.current_points;
    
    const level = getUserLevel(user.lifetime_points);
    const sidebarLevel = document.getElementById('user-level-sidebar');
    if (sidebarLevel) sidebarLevel.textContent = level.title;
    
    const sidebarAvatar = document.getElementById('user-avatar-sidebar');
    if (sidebarAvatar) sidebarAvatar.src = user.profile_img_url || getPlaceholderImage('80x80', getUserInitials(user.full_name));

    // 🟢 FIX: Added safe checks so it doesn't crash if you remove an element from HTML
    const impactRecycled = document.getElementById('impact-recycled');
    if (impactRecycled) impactRecycled.textContent = `${(user.impact?.total_plastic_kg || 0).toFixed(1)} kg`;
    
    const impactCo2 = document.getElementById('impact-co2');
    if (impactCo2) impactCo2.textContent = `${(user.impact?.co2_saved_kg || 0).toFixed(1)} kg`;
    
    const impactEvents = document.getElementById('impact-events');
    if (impactEvents) impactEvents.textContent = user.impact?.events_attended || 0;
};

const renderCheckinButtonState = () => {
    const streak = state.currentUser.checkInStreak || 0;
    
    const preEl = document.getElementById('dashboard-streak-text-pre');
    const postEl = document.getElementById('dashboard-streak-text-post');
    if(preEl) preEl.textContent = streak;
    if(postEl) postEl.textContent = streak;
    
    const btn = els.dailyCheckinBtn;
    if (!btn) return;

    if (state.currentUser.isCheckedInToday) {
        btn.classList.add('checkin-completed'); 
        btn.classList.remove('from-yellow-400', 'to-orange-400', 'dark:from-yellow-500', 'dark:to-orange-500', 'bg-gradient-to-r');
        btn.onclick = null; 
    } else {
        btn.classList.remove('checkin-completed');
        btn.classList.add('from-yellow-400', 'to-orange-400', 'dark:from-yellow-500', 'dark:to-orange-500', 'bg-gradient-to-r');
        btn.onclick = openCheckinModal;
    }
};

export const openCheckinModal = () => {
    if (state.currentUser.isCheckedInToday) return;
    const checkinModal = document.getElementById('checkin-modal');
    checkinModal.classList.add('open');
    checkinModal.classList.remove('invisible', 'opacity-0');
    
    const calendarContainer = document.getElementById('checkin-modal-calendar');
    calendarContainer.innerHTML = '';
    
    const today = new Date(); 
    
    for (let i = -3; i <= 3; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const isToday = i === 0;
        
        calendarContainer.innerHTML += `
            <div class="flex flex-col items-center text-xs ${isToday ? 'font-bold text-yellow-600 dark:text-yellow-400' : 'text-gray-500 dark:text-gray-400'}">
                <span class="mb-1">${['S','M','T','W','T','F','S'][d.getDay()]}</span>
                <span class="w-8 h-8 flex items-center justify-center rounded-full ${isToday ? 'bg-yellow-100 dark:bg-yellow-900' : ''}">${d.getDate()}</span>
            </div>
        `;
    }
    document.getElementById('checkin-modal-streak').textContent = `${state.currentUser.checkInStreak || 0} Days`;
    document.getElementById('checkin-modal-button-container').innerHTML = `
        <button onclick="handleDailyCheckin()" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-green-700 shadow-lg transition-transform active:scale-95">
            Check-in &amp; Earn ${state.checkInReward} Points
        </button>
    `;
};

export const closeCheckinModal = () => {
    const checkinModal = document.getElementById('checkin-modal');
    checkinModal.classList.remove('open');
    checkinModal.classList.add('invisible', 'opacity-0');
};

export const handleDailyCheckin = async () => {
    const checkinButton = document.querySelector('#checkin-modal-button-container button');
    checkinButton.disabled = true;
    checkinButton.textContent = 'Checking in...';

    const optimisticStreak = (state.currentUser.checkInStreak || 0) + 1;

    try {
        const todayIST = getTodayIST();

        const { error } = await supabase.from('daily_checkins').insert({ 
            user_id: state.currentUser.id, 
            points_awarded: state.checkInReward,
            checkin_date: todayIST 
        });
        if (error) throw error;

        closeCheckinModal();

        await refreshUserData(); 

        state.currentUser.checkInStreak = optimisticStreak;
        state.currentUser.isCheckedInToday = true;

        renderCheckinButtonState();

    } catch (err) {
        console.error('Check-in error:', err.message);
        alert(`Failed to check in: ${err.message}`);
        checkinButton.disabled = false;
        checkinButton.textContent = `Check-in & Earn ${state.checkInReward} Points`;
    }
};

export const loadHistoryData = async () => {
    try {
        const { data, error } = await supabase.from('points_ledger').select('*').eq('user_id', state.currentUser.id).order('created_at', { ascending: false });
        if (error) return;
        state.history = data.map(item => ({
            type: item.source_type, description: item.description, points: item.points_delta,
            date: formatDate(item.created_at), 
            icon: getIconForHistory(item.source_type)
        }));
        if (document.getElementById('history').classList.contains('active')) renderHistory();
    } catch (err) { console.error('History Load Error:', err); }
};

export const renderHistory = () => {
    els.historyList.innerHTML = '';
    if (state.history.length === 0) {
        els.historyList.innerHTML = `<p class="text-sm text-center text-gray-500">No activity history yet.</p>`;
        return;
    }
    state.history.forEach(h => {
        els.historyList.innerHTML += `
            <div class="glass-card p-3 rounded-xl flex items-center justify-between">
                <div class="flex items-center">
                    <span class="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mr-3"><i data-lucide="${h.icon}" class="w-5 h-5 text-gray-700 dark:text-gray-200"></i></span>
                    <div><p class="text-sm font-semibold text-gray-800 dark:text-gray-100">${h.description}</p><p class="text-xs text-gray-500 dark:text-gray-400">${h.date}</p></div>
                </div>
                <span class="text-sm font-bold ${h.points >= 0 ? 'text-green-600' : 'text-red-500'}">${h.points > 0 ? '+' : ''}${h.points}</span>
            </div>`;
    });
    if(window.lucide) window.lucide.createIcons();
};

export const renderProfile = () => {
    const u = state.currentUser;
    if (!u) return;
    const l = getUserLevel(u.lifetime_points);
    document.getElementById('profile-name').innerHTML = `${u.full_name} ${getTickImg(u.tick_type)}`;
    document.getElementById('profile-email').textContent = u.email;
    document.getElementById('profile-avatar').src = u.profile_img_url || getPlaceholderImage('112x112', getUserInitials(u.full_name));
    document.getElementById('profile-level-title').textContent = l.title;
    document.getElementById('profile-level-number').textContent = l.level;
    document.getElementById('profile-level-progress').style.width = l.progress + '%';
    document.getElementById('profile-student-id').textContent = u.student_id;
    document.getElementById('profile-course').textContent = u.course;
    document.getElementById('profile-email-personal').textContent = u.email;
};

export const setupFileUploads = () => {
    const profileInput = document.getElementById('profile-upload-input');
    if (profileInput) {
        profileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const avatarEl = document.getElementById('profile-avatar');
            const originalSrc = avatarEl.src;
            avatarEl.style.opacity = '0.5';
            try {
                const imageUrl = await uploadToCloudinary(file);
                const { error } = await supabase.from('users').update({ profile_img_url: imageUrl }).eq('id', state.currentUser.id);
                if (error) throw error;
                state.currentUser.profile_img_url = imageUrl;
                renderProfile();
                renderDashboardUI(); 
                alert('Profile picture updated!');
            } catch (err) {
                console.error('Profile Upload Failed:', err);
                alert('Failed to upload profile picture.');
                avatarEl.src = originalSrc; 
            } finally {
                avatarEl.style.opacity = '1';
                profileInput.value = ''; 
            }
        });
    }
};

window.openCheckinModal = openCheckinModal;
window.closeCheckinModal = closeCheckinModal;
window.handleDailyCheckin = handleDailyCheckin;
