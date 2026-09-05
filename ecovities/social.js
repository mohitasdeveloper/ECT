import { supabase } from './supabase-client.js';
import { state } from './state.js';
import { els, getPlaceholderImage, getTickImg, getUserInitials } from './utils.js';

let currentLeaderboardTab = 'student';

export const loadLeaderboardData = async () => {
    try {
        // 1. Fetch Users + Streak Data
        // We join 'user_streaks' to get the current streak
        // Explicitly specify relationship to avoid ambiguity
        const { data, error } = await supabase
            .from('users')
            .select(`
                id, full_name, course, lifetime_points, profile_img_url, tick_type,
                user_streaks:user_streaks!user_streaks_user_id_fkey ( current_streak )
            `)
            .order('lifetime_points', { ascending: false });

        if (error) throw error;

        // 2. Process Student Leaderboard
        state.leaderboard = data.slice(0, 20).map(u => ({
            ...u,
            name: u.full_name,
            initials: getUserInitials(u.full_name),
            isCurrentUser: u.id === state.currentUser.id,
            // Access streak safely
            streak: (u.user_streaks && u.user_streaks.current_streak) 
                ? u.user_streaks.current_streak 
                : (Array.isArray(u.user_streaks) && u.user_streaks[0] ? u.user_streaks[0].current_streak : 0)
        }));

        // 3. Process Department Leaderboard
        const deptMap = {};
        
        data.forEach(user => {
            // --- FIX: Course Name Cleaning Logic ---
            let cleanCourse = user.course ? user.course.trim().toUpperCase() : 'GENERAL';
            
            // Removes FY, SY, TY from the start (with or without space)
            // Examples: "SYBSC" -> "BSC", "FY BCOM" -> "BCOM", "TY.BA" -> "BA"
            cleanCourse = cleanCourse.replace(/^(FY|SY|TY)[\s.]?/i, '');
            
            // Safety: If name becomes empty or too short, revert to original
            if (cleanCourse.length < 2) cleanCourse = user.course;

            if (!deptMap[cleanCourse]) {
                deptMap[cleanCourse] = { 
                    name: cleanCourse, 
                    totalPoints: 0, 
                    studentCount: 0, 
                    students: [] 
                };
            }

            deptMap[cleanCourse].totalPoints += (user.lifetime_points || 0);
            deptMap[cleanCourse].studentCount += 1;
            
            // Handle streak safely again
            const streakVal = (user.user_streaks && user.user_streaks.current_streak) 
                ? user.user_streaks.current_streak 
                : (Array.isArray(user.user_streaks) && user.user_streaks[0] ? user.user_streaks[0].current_streak : 0);

            deptMap[cleanCourse].students.push({
                name: user.full_name,
                points: user.lifetime_points,
                img: user.profile_img_url,
                tick_type: user.tick_type,
                initials: getUserInitials(user.full_name),
                streak: streakVal
            });
        });

        // Calculate Average & Sort
        state.departmentLeaderboard = Object.values(deptMap).map(dept => ({
            ...dept,
            averageScore: dept.studentCount > 0 ? Math.round(dept.totalPoints / dept.studentCount) : 0
        })).sort((a, b) => b.averageScore - a.averageScore); // Sort by Avg Score
        
        // Render if active
        if (document.getElementById('leaderboard').classList.contains('active')) {
            renderStudentLeaderboard();
            renderDepartmentLeaderboard();
        }
    } catch (err) { console.error('Leaderboard Data Error:', err); }
};

export const showLeaderboardTab = (tab) => {
    currentLeaderboardTab = tab;
    const btnStudent = document.getElementById('leaderboard-tab-student');
    const btnDept = document.getElementById('leaderboard-tab-dept');
    const contentStudent = document.getElementById('leaderboard-content-student');
    const contentDept = document.getElementById('leaderboard-content-department');

    if (tab === 'department') {
        btnDept.classList.add('active'); btnStudent.classList.remove('active');
        contentDept.classList.remove('hidden'); contentStudent.classList.add('hidden');
        if(els.lbLeafLayer) els.lbLeafLayer.classList.add('hidden');
        renderDepartmentLeaderboard();
    } else {
        btnStudent.classList.add('active'); btnDept.classList.remove('active');
        contentStudent.classList.remove('hidden'); contentDept.classList.add('hidden');
        if(els.lbLeafLayer) els.lbLeafLayer.classList.remove('hidden');
        renderStudentLeaderboard();
    }
};

export const renderDepartmentLeaderboard = () => {
    const container = document.getElementById('eco-wars-page-list');
    container.innerHTML = '';
    if (state.departmentLeaderboard.length === 0) { 
        container.innerHTML = `<p class="text-sm text-center text-gray-500">Calculating...</p>`; 
        return; 
    }

    state.departmentLeaderboard.forEach((dept, index) => {
        container.innerHTML += `
            <div class="glass-card p-4 rounded-2xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors mb-3 border border-gray-100 dark:border-gray-700" onclick="showDepartmentDetail('${dept.name}')">
                <div class="flex items-center justify-between">
                    <div class="flex items-center">
                        <span class="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-100 to-green-200 dark:from-emerald-900/60 dark:to-green-900/60 flex items-center justify-center mr-4 text-sm font-bold text-emerald-800 dark:text-emerald-100 shadow-sm">#${index + 1}</span>
                        <div>
                            <p class="font-bold text-lg text-gray-900 dark:text-gray-100">${dept.name}</p>
                            <p class="text-xs text-gray-500 dark:text-gray-400">${dept.studentCount} Students</p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-lg font-extrabold text-green-600 dark:text-green-400">${dept.averageScore}</p>
                        <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400">Avg Score</p>
                    </div>
                </div>
            </div>`;
    });
    if(window.lucide) window.lucide.createIcons();
};

export const showDepartmentDetail = (deptName) => {
    const deptData = state.departmentLeaderboard.find(d => d.name === deptName);
    if (!deptData) return;

    // Sort students by points (High to Low)
    const sortedStudents = deptData.students.sort((a, b) => b.points - a.points);

    const studentsHTML = sortedStudents.length === 0 
        ? `<p class="text-center text-gray-500 py-10">No active students in this department.</p>` 
        : sortedStudents.map((s, idx) => `
            <div class="glass-card p-3 rounded-2xl flex items-center justify-between border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                <div class="flex items-center gap-4">
                    <div class="relative">
                        <img src="${s.img || getPlaceholderImage('60x60', s.initials)}" class="w-12 h-12 rounded-full object-cover border-2 border-white dark:border-gray-700 shadow-sm">
                        <div class="absolute -bottom-1 -right-1 w-5 h-5 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300 border border-white dark:border-gray-600">
                            ${idx + 1}
                        </div>
                    </div>
                    <div>
                        <p class="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1">
                            ${s.name} ${getTickImg(s.tick_type)}
                        </p>
                        <div class="flex items-center mt-0.5">
                            <i data-lucide="flame" class="w-3 h-3 text-orange-500 fill-orange-500 mr-1"></i>
                            <span class="text-xs font-semibold text-orange-600 dark:text-orange-400">${s.streak} Day Streak</span>
                        </div>
                    </div>
                </div>
                <div class="text-right">
                    <span class="text-sm font-extrabold text-green-600 dark:text-green-400">${s.points}</span>
                    <span class="text-[10px] text-gray-400 block font-medium">PTS</span>
                </div>
            </div>
        `).join('');

    els.departmentDetailPage.innerHTML = `
        <div class="sticky top-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md z-10 p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <div class="flex items-center">
                <button onclick="showPage('leaderboard')" class="mr-3 p-2 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                    <i data-lucide="arrow-left" class="w-5 h-5 text-gray-700 dark:text-gray-200"></i>
                </button>
                <div>
                    <h2 class="text-xl font-extrabold text-gray-900 dark:text-gray-100">${deptName}</h2>
                    <p class="text-xs text-gray-500 font-medium">Avg Score: <span class="text-green-600 font-bold">${deptData.averageScore}</span></p>
                </div>
            </div>
        </div>
        <div class="p-4 space-y-3 pb-20">
            ${studentsHTML}
        </div>`;

    window.showPage('department-detail-page');
    if(window.lucide) window.lucide.createIcons();
};

export const renderStudentLeaderboard = () => {
    if (state.leaderboard.length === 0) return;
    const sorted = [...state.leaderboard];
    const rank1 = sorted[0], rank2 = sorted[1], rank3 = sorted[2];
    const rest = sorted.slice(3);

    // Podium Renderer
    const renderChamp = (u, rank) => {
        if (!u) return '';
        return `
            <div class="badge ${rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze'}">
                ${u.profile_img_url ? `<img src="${u.profile_img_url}" class="w-full h-full object-cover">` : u.initials}
            </div>
            <div class="champ-name">${u.name} ${getTickImg(u.tick_type)}</div>
            <div class="champ-points">${u.lifetime_points} pts</div>
            <div class="rank">${rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd'}</div>
        `;
    }

    els.lbPodium.innerHTML = `
        <div class="podium">
            <div class="champ">${renderChamp(rank2, 2)}</div>
            <div class="champ">${renderChamp(rank1, 1)}</div>
            <div class="champ">${renderChamp(rank3, 3)}</div>
        </div>`;

    els.lbList.innerHTML = '';
    rest.forEach((user, index) => {
        els.lbList.innerHTML += `
            <div class="item ${user.isCurrentUser ? 'is-me' : ''}">
                <div class="user">
                    <span class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center mr-3 text-xs font-bold text-gray-600 dark:text-gray-300">#${index + 4}</span>
                    <div class="circle">${user.profile_img_url ? `<img src="${user.profile_img_url}" class="w-full h-full object-cover">` : user.initials}</div>
                    <div class="user-info">
                        <strong>${user.name} ${user.isCurrentUser ? '(You)' : ''} ${getTickImg(user.tick_type)}</strong>
                        <span class="sub-class">${user.course}</span>
                    </div>
                </div>
                <div class="points-display">${user.lifetime_points} pts</div>
            </div>`;
    });
};

window.showLeaderboardTab = showLeaderboardTab;
window.showDepartmentDetail = showDepartmentDetail;
