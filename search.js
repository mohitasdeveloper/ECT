import { supabase } from './supabase.js';
import { showToast } from './ui.js';
import { saveFeaturedServicesToCache, getFeaturedServicesFromCache } from './utils.js';
let currentUser = null;
let searchTimeout = null;
let currentSearchTab = 'all';

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

const LIST_SKELETON = `
    <div class="flex items-start gap-4 py-3 animate-pulse">
        <div class="w-[52px] h-[52px] rounded-full shimmer-bg shrink-0"></div>
        <div class="flex-1 mt-1">
            <div class="h-4 shimmer-bg rounded-md w-1/2 mb-2"></div>
            <div class="h-3 shimmer-bg rounded-md w-3/4 mb-2"></div>
            <div class="h-2.5 shimmer-bg rounded-md w-1/3 mt-3"></div>
        </div>
    </div>
`.repeat(4);

const FEATURED_SKELETON = `
    <div class="bg-surface dark:bg-neutral-900 border border-surface-variant/60 dark:border-neutral-800 rounded-[24px] p-4 animate-pulse">
        <div class="flex items-center justify-between mb-4">
            <div class="h-3.5 shimmer-bg rounded-md w-28"></div>
            <div class="h-4 w-4 shimmer-bg rounded-full"></div>
        </div>
        <div class="grid grid-cols-3 gap-2">
            ${'<div class="flex flex-col items-center gap-2"><div class="w-14 h-14 rounded-2xl shimmer-bg"></div><div class="h-2.5 w-10 shimmer-bg rounded-md"></div></div>'.repeat(3)}
        </div>
    </div>
`.repeat(3);

export function initSearch(user) {
    currentUser = user;
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search-btn');
    const tabsContainer = document.getElementById('search-tabs-container');
    
    // Live Debounced Search Listener
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearTimeout(searchTimeout);
            
            // Toggle Clear Button Visibility
            if (clearBtn) {
                if (query.length > 0) clearBtn.classList.remove('hidden');
                else clearBtn.classList.add('hidden');
            }

            if (query.length === 0) {
                tabsContainer.classList.add('hidden');
                document.getElementById('search-results-container').classList.add('hidden');
                document.getElementById('explore-users-container').classList.remove('hidden');
            } else {
                document.getElementById('explore-users-container').classList.add('hidden');
                tabsContainer.classList.remove('hidden');
                
                const resultsContainer = document.getElementById('search-results-container');
                resultsContainer.classList.remove('hidden');
                resultsContainer.innerHTML = LIST_SKELETON;
                
                searchTimeout = setTimeout(() => {
                    performSearch(query);
                }, 300);
            }
        });
    }

    // Clear Button Click Handler
    if (clearBtn && searchInput) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.classList.add('hidden');
            clearTimeout(searchTimeout);
            
            tabsContainer.classList.add('hidden');
            document.getElementById('search-results-container').classList.add('hidden');
            document.getElementById('explore-users-container').classList.remove('hidden');
            
            searchInput.focus(); // Keep keyboard open
        });
    }

    // Tabs Listener
    if (tabsContainer) {
        tabsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.search-tab-btn');
            if (!btn) return;

            // Reset all tabs to inactive styles
            document.querySelectorAll('.search-tab-btn').forEach(b => {
                b.classList.remove('bg-on-surface', 'text-surface', 'dark:bg-white', 'dark:text-black');
                b.classList.add('bg-surface-variant/30', 'text-on-surface-variant', 'dark:bg-neutral-800', 'dark:text-gray-300');
            });
            
            // Apply active styles to clicked tab
            btn.classList.remove('bg-surface-variant/30', 'text-on-surface-variant', 'dark:bg-neutral-800', 'dark:text-gray-300');
            btn.classList.add('bg-on-surface', 'text-surface', 'dark:bg-white', 'dark:text-black');

            currentSearchTab = btn.dataset.tab;

            const query = searchInput.value.trim();
            if (query.length > 0) {
                document.getElementById('search-results-container').innerHTML = LIST_SKELETON;
                performSearch(query);
            }
        });
    }
    
    fetchFeaturedServices();
}

function getTickHtml(tickType) {
    return window.getTickHtml ? window.getTickHtml(tickType) : '';
}
// Search across all users and services
let latestSearchToken = 0; // Tracks the most recent search

// Search across users (name, course, role) and services (title, desc, author)
async function performSearch(query) {
    const container = document.getElementById('search-results-container');
    
    // Increment token for this specific search to prevent race conditions
    latestSearchToken++;
    const thisSearchToken = latestSearchToken;
    
    try {
        const blockedIds = await window.getBlockedUserIds(currentUser.id);
        const excludeIds = [currentUser.id, ...blockedIds];

        // Clean query for PostgREST 'or' syntax (commas break the array logic)
        const safeQuery = query.replace(/,/g, ' ');

        // Run both queries simultaneously for speed
        const [usersRes, servicesByTextRes] = await Promise.all([
            // 1. Search Users: Name, Course, or User Type (Role)
            supabase
                .from('users')
                .select('id, full_name, profile_img_url, course, tick_type, role')
                .or(`full_name.ilike.%${safeQuery}%,course.ilike.%${safeQuery}%,role.ilike.%${safeQuery}%`)
                .eq('is_deleted', false)
                .eq('is_deactivated', false)
                .not('id', 'in', `(${excludeIds.join(',')})`)
                .limit(20),
            
            // 2. Search Services: Title or Description
            supabase
                .from('page_services')
                .select('id, title, description, icon_name, url, open_in_app, page_id, users!inner(full_name, is_deleted, is_deactivated)')
                .or(`title.ilike.%${safeQuery}%,description.ilike.%${safeQuery}%`)
                .eq('is_active', true)
                .eq('users.is_deleted', false)
                .eq('users.is_deactivated', false)
                .not('page_id', 'in', `(${excludeIds.join(',')})`)
                .limit(20)
        ]);

        if (usersRes.error) throw usersRes.error;
        if (servicesByTextRes.error) throw servicesByTextRes.error;
        
        // If a new search started while we were waiting for the database, abort this one!
        if (thisSearchToken !== latestSearchToken) return;

        const allUsers = usersRes.data || [];
        
        // 3. Search Services By Author ("by__"):
        // If the query matched a Page's name, fetch their services too!
        const matchedPageIds = allUsers.filter(u => u.role === 'page').map(u => u.id);
        let additionalServices = [];
        
        if (matchedPageIds.length > 0) {
            const { data: authorServices } = await supabase
                .from('page_services')
                .select('id, title, description, icon_name, url, open_in_app, page_id, users!inner(full_name, is_deleted, is_deactivated)')
                .in('page_id', matchedPageIds)
                .eq('is_active', true)
                .eq('users.is_deleted', false)
                .eq('users.is_deactivated', false);
                
            if (authorServices) additionalServices = authorServices;
        }

        // Combine and deduplicate all service results
        const servicesDataMap = new Map();
        [...(servicesByTextRes.data || []), ...additionalServices].forEach(svc => {
            servicesDataMap.set(svc.id, svc);
        });
        const servicesData = Array.from(servicesDataMap.values());

        const studentsData = allUsers.filter(u => u.role !== 'page');
        const pagesData = allUsers.filter(u => u.role === 'page');

        let html = '';

      // Inject UI Content based on Active Tab
        if (currentSearchTab === 'all') {
            if (allUsers.length === 0 && servicesData.length === 0) {
                container.innerHTML = getEmptyStateHTML(query);
                return;
            }

            let isFirstSection = true;

            // 1. Pages First
            if (pagesData.length > 0) {
                html += `<h4 class="text-[13px] font-extrabold text-on-surface dark:text-gray-100 mb-2 ${isFirstSection ? 'mt-2' : 'mt-4'}">Pages</h4>`;
                html += renderUserList(pagesData.slice(0, 5));
                isFirstSection = false;
            }

            // 2. Students (Users) Second
            if (studentsData.length > 0) {
                html += `<h4 class="text-[13px] font-extrabold text-on-surface dark:text-gray-100 mb-2 ${isFirstSection ? 'mt-2' : 'mt-4'}">Users</h4>`;
                html += renderUserList(studentsData.slice(0, 5));
                isFirstSection = false;
            }

            // 3. Services Third
            if (servicesData.length > 0) {
                html += `<h4 class="text-[13px] font-extrabold text-on-surface dark:text-gray-100 mb-2 ${isFirstSection ? 'mt-2' : 'mt-4'}">Services</h4>`;
                html += renderServiceList(servicesData.slice(0, 5));
                isFirstSection = false;
            }
        } else if (currentSearchTab === 'users') {
            if (studentsData.length === 0) return container.innerHTML = getEmptyStateHTML(query, 'Users');
            html += renderUserList(studentsData);
        } else if (currentSearchTab === 'pages') {
            if (pagesData.length === 0) return container.innerHTML = getEmptyStateHTML(query, 'Pages');
            html += renderUserList(pagesData);
        } else if (currentSearchTab === 'services') {
            if (servicesData.length === 0) return container.innerHTML = getEmptyStateHTML(query, 'Services');
            html += renderServiceList(servicesData);
        }

        container.innerHTML = html;

    } catch (err) {
        console.error('Search error:', err);
        container.innerHTML = `<p class="text-sm text-center py-4 text-error">Search failed.</p>`;
    }
}

// 🚀 NEW: The ChatGPT Style List Renderer
function renderServiceList(services) {
    return services.map(svc => `
        <div onclick="window.openServiceLink('${svc.url}', ${svc.open_in_app})" class="flex items-start gap-4 py-3 cursor-pointer active:opacity-60 transition-opacity">
            <!-- Circular Icon -->
            <div class="w-[52px] h-[52px] rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
                <span class="material-symbols-outlined text-[26px]">${svc.icon_name}</span>
            </div>
            <!-- Content Area -->
            <div class="flex-1 min-w-0 flex flex-col pt-0.5">
                <p class="font-extrabold text-[15px] text-on-surface dark:text-gray-100 truncate leading-tight">${svc.title}</p>
                ${svc.description ? `<p class="text-[13px] text-on-surface-variant dark:text-gray-400 leading-snug line-clamp-2 mt-1 pr-2">${svc.description}</p>` : ''}
                <p class="text-[11px] font-medium text-on-surface-variant/70 dark:text-gray-500 mt-1.5">
                    By ${svc.users.full_name}
                </p>
            </div>
        </div>
    `).join('');
}

// Existing User Renderer
function renderUserList(users) {
    return users.map(user => {
        const rawAvatarUrl = user.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4`;
        const optimizedAvatar = typeof window.optimizeImageUrl === 'function' ? window.optimizeImageUrl(rawAvatarUrl, 'avatar') : rawAvatarUrl;
        const fallback = `this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4';`;
        
        const subtitle = user.role === 'page' ? 'Official Page' : (user.course || 'Student');

        return `
        <div onclick="window.viewUserProfile('${user.id}')" class="flex items-center gap-3 py-3 cursor-pointer active:opacity-60 transition-opacity">
            <img loading="lazy" src="${optimizedAvatar}" onerror="${fallback}" class="w-[52px] h-[52px] rounded-full object-cover shrink-0 border border-surface-variant/50">

            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1">
                    <p class="font-bold text-[14px] text-on-surface dark:text-gray-100 truncate">
                        ${user.full_name}
                    </p>
                    ${getTickHtml(user.tick_type)}
                </div>
                <p class="text-[13px] font-medium text-on-surface-variant dark:text-gray-500 mt-[1px] truncate">
                    ${subtitle}
                </p>
            </div>
        </div>
        `;
    }).join('');
}

function getEmptyStateHTML(query, type = 'results') {
    return `
        <div class="py-12 flex flex-col items-center justify-center opacity-40 text-on-surface-variant">
            <span class="material-symbols-outlined text-[42px] mb-2">search_off</span>
            <p class="text-sm font-medium">No ${type.toLowerCase()} found matching "${query}"</p>
        </div>
    `;
}

// Featured Services — curated grid shown on the default (empty-query)
// Search view, grouped by provider. Icon tap opens that item's link;
// tapping the card anywhere else opens the provider's page.
async function fetchFeaturedServices() {
    const container = document.getElementById('explore-users-container');
    if (!container) return;

    container.innerHTML = FEATURED_SKELETON;

    // 🚀 OFFLINE INTERCEPTOR
    if (!navigator.onLine) {
        try {
            const cached = await getFeaturedServicesFromCache();
            if (cached.length > 0) {
                container.innerHTML = groupFeaturedServices(cached).map(renderFeaturedGroup).join('');
            } else {
                container.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">Nothing available offline.</p>`;
            }
        } catch (e) { console.error(e); }
        return;
    }

    try {
        const { data, error } = await supabase
            .from('featured_services')
            .select('*')
            .eq('is_active', true)
            .order('group_order', { ascending: true })
            .order('item_order', { ascending: true });
        if (error) throw error;

        if (!data || data.length === 0) {
            container.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">Nothing featured right now.</p>`;
            return;
        }

        container.innerHTML = groupFeaturedServices(data).map(renderFeaturedGroup).join('');

        // 🚀 SAVE TO OFFLINE CACHE
        saveFeaturedServicesToCache(data);
    } catch (err) {
        console.error('Error fetching featured services:', err);
        container.innerHTML = `<p class="text-sm text-center py-8 text-error">Failed to load.</p>`;
    }
}

// Groups flat rows by provider, preserving the order already applied by the query/cache-sort
function groupFeaturedServices(rows) {
    const groups = [];
    const groupIndexByName = new Map();
    rows.forEach(item => {
        if (!groupIndexByName.has(item.provider_name)) {
            groupIndexByName.set(item.provider_name, groups.length);
            groups.push({ provider_name: item.provider_name, provider_user_id: item.provider_user_id, items: [] });
        }
        groups[groupIndexByName.get(item.provider_name)].items.push(item);
    });
    return groups;
}

function renderFeaturedGroup(group) {
    return `
    <div onclick="window.openFeaturedProvider('${group.provider_user_id || ''}')" class="bg-surface dark:bg-neutral-900 border border-surface-variant/60 dark:border-neutral-800 rounded-[24px] p-4 cursor-pointer active:scale-[0.98] transition-all duration-150 shadow-sm hover:shadow-md hover:border-primary/30">
        <div class="flex items-center justify-between mb-4">
            <p class="text-[13.5px] font-extrabold text-on-surface dark:text-gray-100">By ${escapeHtml(group.provider_name)}</p>
            <span class="material-symbols-outlined text-[20px] text-on-surface-variant dark:text-gray-500">chevron_right</span>
        </div>
        <div class="grid grid-cols-3 gap-2">
            ${group.items.map(renderFeaturedItem).join('')}
        </div>
    </div>`;
}

function renderFeaturedItem(item) {
    return `
    <div onclick="event.stopPropagation(); window.openFeaturedServiceLink('${item.link_url}', ${item.open_in_app})" class="flex flex-col items-center gap-2 active:scale-95 transition-transform cursor-pointer">
        <div class="w-14 h-14 rounded-2xl flex items-center justify-center" style="background-color:${item.icon_bg};">
            <span class="material-symbols-outlined text-[26px]" style="color:${item.icon_color};">${item.icon_name}</span>
        </div>
        <p class="text-[12px] font-semibold text-on-surface dark:text-gray-200 text-center leading-tight truncate w-full">${escapeHtml(item.label)}</p>
    </div>`;
}

window.openFeaturedProvider = function (userId) {
    if (!userId) {
        showToast("This provider's page isn't linked yet.", 'info');
        return;
    }
    if (typeof window.viewUserProfile === 'function') window.viewUserProfile(userId);
};

// window.openServiceLink (main.js) already appends student_id/name/theme
// to every link it opens, so featured services just go through it directly.
window.openFeaturedServiceLink = function (baseUrl, openInApp) {
    if (!baseUrl) return;
    window.openServiceLink(baseUrl, openInApp);
};


