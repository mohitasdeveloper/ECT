import { supabase } from './supabase.js';
import { showToast, popupMenuItem } from './ui.js';
import { timeAgo, compressImage, saveFeedToCache, getFeedFromCache, queueOfflineAction } from './utils.js'; // <-- Updated
import { CLOUDINARY_CLOUD_NAME } from './config.js';
import { getUserSuggestions, getBlockedUserIds } from './data-layer.js';

let currentUser = null;
let isVoting = false; 
let quillEditor = null;

function initQuillEditor() {
    if (quillEditor) return;
    
    quillEditor = new Quill('#rich-text-editor', {
        theme: 'snow',
        placeholder: 'What\'s on your mind? (@ to mention)',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline', 'strike']
            ],
            mention: {
                allowedChars: /^[A-Za-z\sÅÄÖåäö]*$/,
                mentionDenotationChars: ["@"],
                source: function (searchTerm, renderList) {
                    if (searchTerm.length === 0) {
                        renderList([], searchTerm);
                        return;
                    }
                    
                    // Clear previous timeout if user is still typing
                    clearTimeout(window._quillMentionTimeout);
                    
                    // Wait 300ms after they stop typing before hitting the database
                    window._quillMentionTimeout = setTimeout(async () => {
                        try {
                            const { data, error } = await supabase.rpc('search_mentionable_users', {
                                p_search_term: searchTerm,
                                p_current_user_id: currentUser.id
                            });
                            if (error) throw error;
                            
                            const matches = data.map(u => ({
                                id: u.id,
                                value: u.full_name,
                                avatar: u.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.full_name)}`
                            }));
                            renderList(matches, searchTerm);
                        } catch (e) {
                            renderList([], searchTerm);
                        }
                    }, 300);
                },
                renderItem: function(item) {
                    return `<div class="flex items-center gap-3">
                                <img src="${item.avatar}" class="w-8 h-8 rounded-full object-cover border border-surface-variant/50">
                                <span class="text-[14px] font-bold text-on-surface dark:text-gray-100">${item.value}</span>
                            </div>`;
                }
            }
        }
    });
}

const FEED_SKELETON = `
    <div class="bg-surface-container-lowest dark:bg-[#1e1e1e] rounded-[32px] p-5 border border-surface-variant/60 dark:border-neutral-800 shadow-sm mb-5 animate-pulse">
        <div class="flex items-center gap-3 mb-4">
            <div class="w-10 h-10 rounded-full bg-surface-variant/50 dark:bg-neutral-800 shrink-0"></div>
            <div class="flex-1">
                <div class="h-3.5 bg-surface-variant/50 dark:bg-neutral-800 rounded-md w-1/3 mb-2"></div>
                <div class="h-2.5 bg-surface-variant/50 dark:bg-neutral-800 rounded-md w-1/4"></div>
            </div>
        </div>
        <div class="h-3 bg-surface-variant/50 dark:bg-neutral-800 rounded-md w-3/4 mb-2"></div>
        <div class="h-3 bg-surface-variant/50 dark:bg-neutral-800 rounded-md w-full mb-2"></div>
        <div class="h-3 bg-surface-variant/50 dark:bg-neutral-800 rounded-md w-5/6 mb-4"></div>
        <div class="w-full h-48 bg-surface-variant/50 dark:bg-neutral-800 rounded-2xl mb-4"></div>
    </div>
`.repeat(3);

function getPollTimeLeft(dateStr) {
    if (!dateStr) return '';
    const diff = new Date(dateStr) - new Date();
    if (diff <= 0) return 'Ended';
    const h = Math.floor(diff / (1000 * 60 * 60));
    if (h >= 24) return `${Math.floor(h / 24)}d`;
    if (h > 0) return `${h}h`;
    return `${Math.floor(diff / (1000 * 60))}m`;
}

export function initFeed(user) {
    currentUser = user;
    
    setupCreatePostPermissions();
    refreshMainFeed();
    setupImagePreviews();
    setupLikesModalTouchPhysics();
    
    // 🚀 NEW: Initialize the Realtime listener for new posts
    setupRealtimeFeed();
    
    document.addEventListener('openCreatePostView', () => {
        if(currentUser) {
            document.getElementById('create-post-avatar').src = currentUser.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.full_name)}&background=e1e3e4`;
            document.getElementById('create-post-name').innerHTML = `${currentUser.full_name} ${window.getTickHtml ? window.getTickHtml(currentUser.tick_type) : ''}`;
        }
        initQuillEditor();
    });

    document.body.addEventListener('click', (e) => {
        const commentBtn = e.target.closest('.comment-btn');
        const profileLink = e.target.closest('.profile-link');
        const optionsBtn = e.target.closest('.post-options-btn');
        const commentOptionsBtn = e.target.closest('.comment-options-btn');
        const mentionLink = e.target.closest('.mention');
        const sendCommentBtn = e.target.closest('#send-comment-btn'); 

        if (commentBtn) window.openCommentsModal(commentBtn.dataset.postId);
        if (profileLink) window.viewUserProfile(profileLink.dataset.userId);
        
        if (optionsBtn) {
            window.openPostOptions(
                optionsBtn.dataset.postId, 
                optionsBtn.dataset.userId, 
                optionsBtn.dataset.isVerified === 'true',
                optionsBtn.dataset.hideLikes === 'true',
                optionsBtn.dataset.disableComments === 'true',
                optionsBtn.dataset.isArchived === 'true',
                optionsBtn.dataset.postType,
                optionsBtn.dataset.isPollActive === 'true',
                optionsBtn
            );
        }
        
        if (commentOptionsBtn) window.openCommentOptions(commentOptionsBtn.dataset.commentId, commentOptionsBtn.dataset.userId);
        if (mentionLink && mentionLink.dataset.id) {
            e.preventDefault(); 
            window.viewUserProfile(mentionLink.dataset.id);
        }

        if (sendCommentBtn && !sendCommentBtn.disabled) {
            submitComment(sendCommentBtn.dataset.postId);
        }
    });
    
    document.getElementById('submit-post-btn')?.addEventListener('click', submitPost);
    document.getElementById('submit-report-post-btn')?.addEventListener('click', submitPostReport);
    
    document.getElementById('close-post-comments-btn')?.addEventListener('click', () => {
        if (typeof window.closeCommentsModal === 'function') window.closeCommentsModal();
    });

    document.querySelectorAll('.post-type-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.post-type-tab').forEach(t => {
                t.classList.remove('bg-primary', 'text-white');
                t.classList.add('bg-surface-variant/50', 'dark:bg-surface-variant/10', 'text-on-surface-variant', 'dark:text-gray-300');
            });
            e.currentTarget.classList.remove('bg-surface-variant/50', 'dark:bg-surface-variant/10', 'text-on-surface-variant', 'dark:text-gray-300');
            e.currentTarget.classList.add('bg-primary', 'text-white');
            
            document.querySelectorAll('.post-input-section').forEach(sec => {
                sec.classList.remove('block');
                sec.classList.add('hidden');
            });
            const targetSection = document.getElementById(`input-${e.currentTarget.dataset.type}`);
            if(targetSection) {
                targetSection.classList.remove('hidden');
                targetSection.classList.add('block');
            }
            document.getElementById('current-post-type').value = e.currentTarget.dataset.type;
        });
    });
}

function setupCreatePostPermissions() {
    if (currentUser?.special_post) {
        document.querySelectorAll('.post-type-tab').forEach(tab => tab.classList.remove('hidden'));
    } else {
        document.querySelectorAll('.post-type-tab').forEach(tab => {
            if (tab.dataset.type === 'text' || tab.dataset.type === 'image') {
                tab.classList.remove('hidden');
            } else {
                tab.classList.add('hidden');
            }
        });
    }
}

function setupImagePreviews() {
    const attachPreview = (inputId, containerId, iconId, textId) => {
        const input = document.getElementById(inputId);
        const container = document.getElementById(containerId);
        if(!input || !container) return;
        
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    container.innerHTML = `
                        <img src="${event.target.result}" class="w-full h-auto max-h-[60vh] object-contain rounded-xl">
                        <button type="button" class="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition-colors z-10" onclick="event.stopPropagation(); document.getElementById('${inputId}').value=''; document.getElementById('${containerId}').innerHTML='<span class=\\'material-symbols-outlined text-[32px] mb-2\\'>${iconId}</span><span class=\\'text-sm font-medium\\'>${textId}</span>';">
                            <span class="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    `;
                };
                reader.readAsDataURL(file);
            }
        });
    };
    attachPreview('post-image-upload', 'post-image-preview-container', 'add_photo_alternate', 'Tap to upload image');
    attachPreview('event-image-upload', 'event-image-preview-container', 'wallpaper', 'Add Event Cover Photo');
}

async function uploadToCloudinary(file) {
    showToast('Compressing image...', 'info'); 
    const compressedFile = await compressImage(file, 1080, 0.7);
    const formData = new FormData();
    formData.append('file', compressedFile);
    formData.append('upload_preset', 'ecampus_posts');

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: formData,
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.secure_url;
}

async function submitPost() {
    if (!window.checkVerification('create a post')) return;
    
    const postType = document.getElementById('current-post-type').value;
    const contentHTML = quillEditor ? quillEditor.root.innerHTML : '';
    const plainText = quillEditor ? quillEditor.getText().trim() : '';
    
    if (!plainText && postType === 'text') {
        showToast('Please write something to post.', 'warning');
        return;
    }

    const btn = document.getElementById('submit-post-btn');
    btn.disabled = true;
    btn.textContent = 'Publishing...';

    try {
        const expiryDays = parseInt(document.getElementById('post-expiry-value').value) || 7;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiryDays);

        const viewersAccess = document.getElementById('post-viewers-value')?.value || 'all';
        const mentionedIds = [];
        if (quillEditor) {
            quillEditor.getContents().ops.forEach(op => {
                if (op.insert && op.insert.mention) {
                    mentionedIds.push(op.insert.mention.id);
                }
            });
        }

        let basePayload = { 
            user_id: currentUser.id, 
            post_type: postType, 
            content: contentHTML,
            expires_at: expiresAt.toISOString(),
            viewers_access: viewersAccess,
            mentioned_user_ids: mentionedIds,
            hide_likes: document.getElementById('post-hide-likes')?.checked || false,
            disable_comments: document.getElementById('post-disable-comments')?.checked || false
        };

        if (postType === 'image') {
            const fileInput = document.getElementById('post-image-upload');
            if (!fileInput.files[0]) throw new Error("Please select an image to upload.");
            basePayload.media_url = await uploadToCloudinary(fileInput.files[0]);
        }

        const { data: newPost, error: postError } = await supabase.from('posts').insert(basePayload).select('id').single();
        if (postError) throw postError;
        const newPostId = newPost.id;

        if (postType === 'poll') {
            const inputs = document.querySelectorAll('.poll-opt-input');
            const rawOptions = Array.from(inputs).map(inp => inp.value.trim()).filter(val => val !== '');
            if (rawOptions.length < 2) throw new Error("Polls need at least 2 options.");
            
            const formattedOptions = rawOptions.map((opt, index) => ({ id: (index + 1).toString(), text: opt }));
            
            const votersVisibility = document.getElementById('poll-voters-access')?.value || 'all';
            let allowedVoterIds = [];
            if (votersVisibility === 'custom') {
                allowedVoterIds = currentUser.custom_voters_list || [];
                if (allowedVoterIds.length === 0) throw new Error("Your Custom Voters List is empty. Please set it up in Settings first.");
            }

            const isQuiz = document.getElementById('poll-is-quiz')?.checked || false;
            let correctOptionId = null;
            if (isQuiz) {
                const correctIndex = document.getElementById('poll-correct-option-index')?.value;
                if (!correctIndex || correctIndex < 1 || correctIndex > formattedOptions.length) {
                    throw new Error("Please enter a valid Correct Option Number for the quiz.");
                }
                correctOptionId = correctIndex.toString();
            }

            const pollPayload = {
                post_id: newPostId,
                options: formattedOptions,
                is_multiple_choice: document.getElementById('poll-is-multiple')?.checked || false,
                can_undo_vote: document.getElementById('poll-can-undo')?.checked || false,
                voters_list_visibility: document.getElementById('poll-voters-visibility')?.checked ? 'hidden' : 'public',
                voters_access: votersVisibility === 'custom' ? 'selected' : votersVisibility,
                allowed_voter_ids: allowedVoterIds,
                deadline_type: document.getElementById('poll-deadline-type')?.value === 'post_expiry' ? 'time' : (document.getElementById('poll-deadline-type')?.value || 'time'),
                is_quiz: isQuiz,
                correct_option_id: correctOptionId,
                extra_info: document.getElementById('poll-explanation')?.value.trim() || null
            };

            if (document.getElementById('poll-deadline-type')?.value === 'time') {
                const timeVal = document.getElementById('poll-deadline-time')?.value;
                if (!timeVal) throw new Error("Please select a valid deadline time.");
                pollPayload.deadline_time = new Date(timeVal).toISOString();
            } else if (pollPayload.deadline_type === 'voter_count') {
                const countVal = parseInt(document.getElementById('poll-deadline-count')?.value);
                if (!countVal || countVal < 1) throw new Error("Please enter a valid target vote count.");
                pollPayload.deadline_count = countVal;
            }

            const { error: pollError } = await supabase.from('post_polls').insert(pollPayload);
            if (pollError) throw pollError;
        }
        else if (postType === 'event') {
            const dateVal = document.getElementById('event-date')?.value;
            if (!dateVal) throw new Error("Please select an event date and time.");

            const eventPayload = {
                post_id: newPostId,
                event_date: new Date(dateVal).toISOString(),
                event_location: document.getElementById('event-location')?.value.trim() || null,
                enable_rsvp: document.getElementById('event-enable-rsvp')?.checked || false,
                rsvp_list_visibility: document.getElementById('event-rsvp-visibility')?.value || 'public',
                show_register_btn: document.getElementById('event-show-register')?.checked || false,
                register_url: document.getElementById('event-register-url')?.value.trim() || null
            };

            const fileInput = document.getElementById('event-image-upload');
            if (fileInput?.files[0]) eventPayload.event_image_url = await uploadToCloudinary(fileInput.files[0]);

            const { error: eventError } = await supabase.from('post_events').insert(eventPayload);
            if (eventError) throw eventError;
        }

        if (currentUser.role === 'page') {
            await supabase.rpc('notify_page_followers', { p_page_id: currentUser.id, p_type: 'page_new_post', p_message: 'published a new post.', p_target_id: newPostId });
        }

        window.closeCreatePostView();
        if (quillEditor) quillEditor.setContents([]);
        if (document.getElementById('post-image-upload')) document.getElementById('post-image-upload').value = '';
        if (document.getElementById('event-image-upload')) document.getElementById('event-image-upload').value = '';
        
        showToast('Post published successfully!', 'success');
        window.refreshMainFeed();

    } catch (error) {
        showToast(error.message || 'Failed to create post.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Publish';
    }
}

let lastPostDate = null; // We use a date cursor instead of page numbers now
const POSTS_PER_PAGE = 7; 
let isFetchingFeed = false;
let hasMorePosts = true;

window.refreshMainFeed = async function() {
    lastPostDate = null; // Reset the cursor on refresh
    hasMorePosts = true;
    const container = document.getElementById('feed-posts-container');
    if (container) container.innerHTML = FEED_SKELETON;
    await fetchPosts(true);
};

async function fetchPosts(isRefresh = false) {
    if (isFetchingFeed || (!hasMorePosts && !isRefresh)) return;
    isFetchingFeed = true;

    // 🚀 FIXED: Removed dynamic import that was crashing offline
    if (!navigator.onLine) {
        showToast('You are offline. Showing saved posts.', 'warning');
        try {
            const cachedPosts = await getFeedFromCache();
            const oldSentinel = document.getElementById('feed-bottom-sentinel');
            if (oldSentinel) oldSentinel.remove();
            
            renderPosts(cachedPosts, true);
        } catch (e) {
            console.error("Offline cache error:", e);
        } finally {
            isFetchingFeed = false;
        }
        return;
    }

    try {
        const blockedIds = await window.getBlockedUserIds(currentUser.id);
        
        // 1. Build the base query using .limit() instead of .range()
        let query = supabase
            .from('posts')
            .select(`
                *,
                users!inner(id, full_name, profile_img_url, tick_type, role, is_deleted, is_deactivated),
                post_likes(user_id, users(full_name)),
                post_comments(id, content, created_at, is_deleted, parent_comment_id, users(id, full_name, profile_img_url, tick_type)),
                post_polls(*),
                post_poll_votes(user_id, option_id),
                post_events(*),
                post_event_rsvps(user_id, status),
                saved_posts(user_id)
            `)
            .eq('is_deleted', false) 
            .eq('is_archived', false)
            .gt('expires_at', new Date().toISOString())
            .or('is_reported.eq.false,is_verified.eq.true')
            .eq('users.is_deleted', false)
            .eq('users.is_deactivated', false)
            .order('created_at', { ascending: false })
            .limit(POSTS_PER_PAGE);

        // 2. Apply Cursor: If scrolling down, fetch posts older than the last one we saw
        if (lastPostDate && !isRefresh) {
            query = query.lt('created_at', lastPostDate);
        }

        if (blockedIds.length > 0) {
            query = query.not('user_id', 'in', `(${blockedIds.join(',')})`);
        }

        const { data, error } = await query;
        if (error) throw error;

        // 3. Update the cursor for the next scroll
        if (data.length > 0) {
            lastPostDate = data[data.length - 1].created_at;
        }

        if (data.length < POSTS_PER_PAGE) hasMorePosts = false;

        const oldSentinel = document.getElementById('feed-bottom-sentinel');
        if (oldSentinel) oldSentinel.remove();

        renderPosts(data, isRefresh);

        // 🚀 SAVE TO OFFLINE CACHE (Only cache the first page so we don't overload storage)
        if (isRefresh && data.length > 0) {
            try {
                saveFeedToCache(data);
            } catch (cacheErr) {
                console.error("Failed to save to cache:", cacheErr);
            }
        }

        // 🚀 INJECT SUGGESTIONS WIDGET ON FIRST LOAD AFTER 1ST POST
        if (isRefresh) {
            setTimeout(async () => {
                const suggestions = await fetchUserSuggestions();
                if (suggestions.length > 0) {
                    const suggestionsHtml = generateSuggestionsHTML(suggestions);
                    const container = document.getElementById('feed-posts-container');
                    const firstPost = container.firstElementChild; 
                    
                    if (firstPost && !document.getElementById('suggestions-widget')) {
                        firstPost.insertAdjacentHTML('afterend', suggestionsHtml);
                    } else if (!document.getElementById('suggestions-widget')) {
                        container.insertAdjacentHTML('afterbegin', suggestionsHtml);
                    }
                }
            }, 800);
        }
        
        if (hasMorePosts) setupIntersectionObserver();

    } catch (error) {
        console.error("Supabase Feed Error:", error);
        if (isRefresh) {
            const container = document.getElementById('feed-posts-container');
            if (container) container.innerHTML = `<p class="text-center py-10 text-error">Failed to load feed.</p>`;
        } else {
            import('./ui.js').then(({ showToast }) => showToast('Network error. Scroll down to retry.', 'error'));
            if (hasMorePosts) setupIntersectionObserver();
        }
    } finally {
        isFetchingFeed = false;
    }
}
// ==========================================
// 🚀 NEW: SUGGESTIONS ENGINE
// ==========================================

window.dismissSuggestion = function(btn) {
    const card = btn.closest('.suggestion-card');
    if (card) {
        card.style.transition = 'all 0.3s ease';
        card.style.width = '0px';
        card.style.opacity = '0';
        card.style.margin = '0px';
        card.style.padding = '0px';
        card.style.border = 'none';
        
        setTimeout(() => {
            card.remove();
            const container = document.getElementById('suggestions-widget-container');
            if (container && container.children.length === 0) {
                const widget = document.getElementById('suggestions-widget');
                if (widget) {
                    widget.style.transition = 'all 0.3s ease';
                    widget.style.opacity = '0';
                    widget.style.height = '0px';
                    setTimeout(() => widget.remove(), 300);
                }
            }
        }, 300);
    }
};

function suggestionActionBtn(user, compact) {
    const sizeClasses = compact ? 'px-4 py-1.5 rounded-full text-[12.5px]' : 'w-full py-1.5 rounded-xl text-[12px]';
    if (user.role === 'page') {
        return `<button onclick="window.handleFollowAction('${user.id}', 'follow', this); setTimeout(() => ${compact ? `window.dismissSuggestionRow(this, '${user.id}')` : 'window.dismissSuggestion(this)'}, 500);" class="${sizeClasses} bg-primary text-white font-bold active:scale-95 transition-transform shadow-sm shrink-0">Follow</button>`;
    }
    return `<button onclick="window.handleConnectionAction('${user.id}', 'request', this); setTimeout(() => ${compact ? `window.dismissSuggestionRow(this, '${user.id}')` : 'window.dismissSuggestion(this)'}, 500);" class="${sizeClasses} bg-primary text-white font-bold active:scale-95 transition-transform shadow-sm shrink-0">Connect</button>`;
}

// ==========================================
// "See All" — full list panel (not just the 12-wide widget rail)
// ==========================================
window.openSuggestedUsersPanel = async function () {
    const modal = document.getElementById('modal-suggested-users');
    const list = document.getElementById('suggested-users-list');
    if (!modal || !list) return;

    modal.classList.replace('hidden', 'flex');
    setTimeout(() => modal.classList.remove('translate-x-full'), 10);

    list.innerHTML = `
        <div class="flex items-center gap-3.5 p-2.5 mb-1 animate-pulse">
            <div class="w-12 h-12 rounded-full shimmer-bg shrink-0"></div>
            <div class="flex-1"><div class="h-3.5 shimmer-bg rounded-md w-1/3 mb-2.5"></div><div class="h-3 shimmer-bg rounded-md w-2/3"></div></div>
        </div>
    `.repeat(8);

    try {
        const users = await getUserSuggestions(currentUser.id, 60);
        renderSuggestedUsersList(users);
    } catch (e) {
        console.error('Error loading suggestions:', e);
        list.innerHTML = `<p class="text-sm italic text-center py-8 text-error">Failed to load suggestions.</p>`;
    }
};

window.closeSuggestedUsersPanel = function () {
    const modal = document.getElementById('modal-suggested-users');
    if (!modal) return;
    modal.classList.add('translate-x-full');
    setTimeout(() => modal.classList.replace('flex', 'hidden'), 300);
};

function renderSuggestedUsersList(users) {
    const list = document.getElementById('suggested-users-list');
    if (!list) return;

    if (!users || users.length === 0) {
        list.innerHTML = `<div class="py-16 flex flex-col items-center justify-center opacity-40 text-on-surface-variant"><span class="material-symbols-outlined text-[42px] mb-2">group_off</span><p class="text-sm font-semibold">No suggestions right now.</p></div>`;
        return;
    }

    list.innerHTML = users.map(user => {
        const optimizedAvatar = typeof window.optimizeImageUrl === 'function' ? window.optimizeImageUrl(user.profile_img_url, 'avatar') : user.profile_img_url;
        const fallback = `this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4';`;
        const tickHtml = window.getTickHtml ? window.getTickHtml(user.tick_type) : '';
        const subtitle = user.role === 'page' ? 'Official Page' : (user.course || 'Suggested for you');

        return `
        <div id="sugg-row-${user.id}" class="flex items-center gap-3.5 p-2.5 rounded-2xl hover:bg-surface-variant/20 dark:hover:bg-neutral-800/50 transition-all">
            <img onclick="window.closeSuggestedUsersPanel(); setTimeout(() => window.viewUserProfile('${user.id}'), 220);" loading="lazy" src="${optimizedAvatar || fallback}" onerror="${fallback}" class="w-12 h-12 rounded-full object-cover border border-surface-variant/50 cursor-pointer shrink-0">
            <div class="flex-1 min-w-0 cursor-pointer" onclick="window.closeSuggestedUsersPanel(); setTimeout(() => window.viewUserProfile('${user.id}'), 220);">
                <p class="font-bold text-[14.5px] text-on-surface dark:text-gray-100 truncate flex items-center gap-1">${user.full_name} ${tickHtml}</p>
                <p class="text-[12px] font-medium text-on-surface-variant dark:text-gray-500 mt-0.5 truncate">${subtitle}</p>
            </div>
            <div class="shrink-0 flex items-center gap-1.5">
                ${suggestionActionBtn(user, true)}
                <button onclick="window.dismissSuggestionRow(this, '${user.id}')" class="p-1.5 rounded-full hover:bg-surface-variant/40 dark:hover:bg-white/5 text-on-surface-variant active:scale-90 transition-transform">
                    <span class="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>
        </div>`;
    }).join('');
}

window.dismissSuggestionRow = function (btn, userId) {
    const row = btn.closest('[id^="sugg-row-"]') || document.getElementById(`sugg-row-${userId}`);
    if (!row) return;
    row.style.transition = 'all 0.25s ease';
    row.style.opacity = '0';
    row.style.height = row.offsetHeight + 'px';
    requestAnimationFrame(() => { row.style.height = '0px'; row.style.margin = '0px'; row.style.padding = '0px'; });
    setTimeout(() => {
        row.remove();
        const list = document.getElementById('suggested-users-list');
        if (list && list.children.length === 0) {
            list.innerHTML = `<div class="py-16 flex flex-col items-center justify-center opacity-40 text-on-surface-variant"><span class="material-symbols-outlined text-[42px] mb-2">group_off</span><p class="text-sm font-semibold">No suggestions right now.</p></div>`;
        }
    }, 260);

    // Keep the widget rail on the feed in sync too, if that suggestion is shown there
    const widgetCard = document.querySelector(`#suggestions-widget-container [onclick*="'${userId}'"]`)?.closest('.suggestion-card');
    if (widgetCard) window.dismissSuggestion(widgetCard.querySelector('[onclick*="dismissSuggestion"]'));
};

async function fetchUserSuggestions() {
    // OPTIMIZED: Uses data-layer caching - reduces 3 API calls to 1 cached call
    if (!navigator.onLine) return [];

    try {
        return await getUserSuggestions(currentUser.id);
    } catch (e) {
        console.error("Suggestions fetch error:", e);
        return [];
    }
}

function generateSuggestionsHTML(users) {
    if (!users || users.length === 0) return '';

    const cards = users.map(user => {
        const optimizedAvatar = typeof window.optimizeImageUrl === 'function' ? window.optimizeImageUrl(user.profile_img_url, 'avatar') : user.profile_img_url;
        const fallback = `this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4';`;
        const tickHtml = window.getTickHtml ? window.getTickHtml(user.tick_type) : '';

        return `
        <div class="suggestion-card relative flex flex-col items-center p-3.5 bg-surface dark:bg-neutral-900 border border-surface-variant/60 dark:border-neutral-800 rounded-2xl w-[140px] snap-start shrink-0 shadow-sm overflow-hidden">
            <button onclick="window.dismissSuggestion(this)" class="absolute top-2 right-2 text-on-surface-variant hover:text-on-surface p-1 rounded-full bg-surface-variant/20 dark:bg-black/50 active:scale-90 transition-transform">
                <span class="material-symbols-outlined text-[14px]">close</span>
            </button>
            <img onclick="window.viewUserProfile('${user.id}')" loading="lazy" src="${optimizedAvatar || fallback}" onerror="${fallback}" class="w-[60px] h-[60px] rounded-full object-cover border border-surface-variant/50 shadow-sm cursor-pointer mb-2.5">
            <p onclick="window.viewUserProfile('${user.id}')" class="font-bold text-[13px] text-on-surface dark:text-gray-100 w-full text-center cursor-pointer hover:underline flex items-center justify-center gap-0.5 truncate leading-tight">${user.full_name.split(' ')[0]} ${tickHtml}</p>
            <p class="text-[11px] font-medium text-on-surface-variant dark:text-gray-500 mb-3 truncate w-full text-center">${user.role === 'page' ? 'Official Page' : 'Suggested for you'}</p>
            ${suggestionActionBtn(user, false)}
        </div>
        `;
    }).join('');

    return `
    <div id="suggestions-widget" class="bg-surface-variant/5 dark:bg-[#121212] py-4 mb-6 border-b border-surface-variant/40 dark:border-neutral-800 animate-fadeIn">
        <div class="flex justify-between items-center px-4 mb-3">
            <h4 class="text-[14px] font-extrabold text-on-surface dark:text-gray-100 tracking-tight">Suggested for you</h4>
            <span onclick="window.openSuggestedUsersPanel()" class="text-[12px] font-bold text-primary cursor-pointer active:opacity-70">See All</span>
        </div>
        <div id="suggestions-widget-container" class="flex gap-3 overflow-x-auto hide-scrollbar px-4 pb-2 snap-x scroll-smooth">
            ${cards}
        </div>
    </div>
    `;
}

// ==========================================
// RESUME EXISTING FEED.JS LOGIC
// ==========================================

function setupIntersectionObserver() {
    const container = document.getElementById('feed-posts-container');
    if (!container) return;
    let sentinel = document.getElementById('feed-bottom-sentinel');
    if (sentinel) sentinel.remove();

    sentinel = document.createElement('div');
    sentinel.id = 'feed-bottom-sentinel';
    sentinel.className = 'w-full py-8 flex justify-center';
    sentinel.innerHTML = `<span class="material-symbols-outlined animate-spin text-primary text-[28px]">progress_activity</span>`;
    container.appendChild(sentinel);

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            observer.disconnect(); 
            fetchPosts(false); 
        }
    }, { rootMargin: '400px' });

    observer.observe(sentinel);
}

function renderPosts(posts, isRefresh = false) {
    const container = document.getElementById('feed-posts-container');
    if (!container) return;

    if (posts.length === 0 && isRefresh) {
        container.innerHTML = `<div class="py-12 flex flex-col items-center justify-center opacity-40"><span class="material-symbols-outlined text-[42px] mb-2">photo_camera</span><p class="text-sm font-medium text-on-surface-variant">The feed is empty.</p></div>`;
        return;
    }

    const htmlString = posts.map(post => {
        const user = post.users;
        if (!user) return '';

        const likes = post.post_likes || [];
        const likeCount = likes.length;
        const userHasLiked = likes.some(like => like.user_id === currentUser.id);
        const savedPosts = post.saved_posts || [];
        const isSaved = savedPosts.some(s => s.user_id === currentUser.id);
        
        let likedByHtml = '';
        if (likeCount > 0) {
            if (post.hide_likes) {
                const featuredLiker = likes.find(l => l.user_id !== currentUser.id)?.users?.full_name || likes[0]?.users?.full_name || 'Someone';
                likedByHtml = likeCount === 1 
                    ? `Liked by <span class="font-bold text-on-surface dark:text-gray-100">${featuredLiker}</span>` 
                    : `Liked by <span class="font-bold text-on-surface dark:text-gray-100">${featuredLiker}</span> and <span onclick="window.openLikesModal('${post.id}')" class="font-bold text-on-surface dark:text-gray-100 cursor-pointer">others</span>`;
            } else {
                likedByHtml = `<span onclick="window.openLikesModal('${post.id}')" class="font-bold text-on-surface dark:text-gray-100 cursor-pointer">${likeCount} ${likeCount === 1 ? 'like' : 'likes'}</span>`;
            }
        }

        let commentsSectionHtml = '';
        if (!post.disable_comments) {
            const comments = (post.post_comments || []).filter(c => !c.is_deleted);
            const commentCount = comments.length;
            let commentsHtml = '';
            if (commentCount > 0) {
                const previewCount = commentCount > 1 ? `View all ${commentCount} comments` : 'View 1 comment';
                commentsHtml = `<p data-post-id="${post.id}" class="comment-btn text-[14px] text-on-surface-variant dark:text-gray-400 mt-1 cursor-pointer active:opacity-70">${previewCount}</p>`;
                
                const latestComment = comments[comments.length - 1];
                if (latestComment && latestComment.content) {
                    const cleanComment = latestComment.content.replace(/<[^>]*>?/gm, '').replace(/\u00A0/g, ' ');
                    commentsHtml += `<p class="text-[14px] text-on-surface dark:text-gray-100 mt-1 leading-snug"><span class="font-bold mr-1 cursor-pointer">${latestComment.users?.full_name || 'User'}</span><span class="text-on-surface-variant dark:text-gray-300">${cleanComment}</span></p>`;
                }
            }
            
            commentsSectionHtml = `
                <div class="px-3 mt-1">${commentsHtml}</div>
                <div class="px-3 mt-2 flex items-center gap-2">
                    <img src="${currentUser?.profile_img_url || 'https://ui-avatars.com/api/?name=User'}" class="w-6 h-6 rounded-full object-cover border border-surface-variant/50 shrink-0">
                    <p data-post-id="${post.id}" class="comment-btn flex-1 text-[13px] text-on-surface-variant dark:text-gray-500 cursor-text">Add a comment...</p>
                </div>
            `;
        }

        const verifiedBadge = window.getTickHtml ? window.getTickHtml(user.tick_type) : '';
        const rawAvatarUrl = user.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4`;
        const optimizedAvatar = typeof optimizeImageUrl === 'function' ? optimizeImageUrl(rawAvatarUrl, 'avatar') : rawAvatarUrl;
        const headerIcon = `<img loading="lazy" src="${optimizedAvatar}" data-user-id="${user.id}" class="profile-link w-8 h-8 rounded-full border border-surface-variant shadow-sm object-cover cursor-pointer hover:opacity-80 transition-opacity shrink-0">`;

        // 🚀 FIX: Robust empty post stripper (Removes invisible Quill spaces)
        let cleanCaptionContent = post.content || '';
        const plainTextCheck = cleanCaptionContent.replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, '').trim();
        if (plainTextCheck === '' && !cleanCaptionContent.includes('<img') && !cleanCaptionContent.includes('<iframe')) {
            cleanCaptionContent = '';
        } else {
            cleanCaptionContent = cleanCaptionContent.replace(/^(<p><br><\/p>\s*)+/, '').replace(/(<p><br><\/p>\s*)+$/, '').trim();
        }

        let isPollActive = false;
        let contentHtml = '';

        if (post.post_type === 'text') {
            if (cleanCaptionContent !== '') {
                contentHtml = `<div class="px-4 py-8 mt-2 mb-2 bg-surface-variant/10 dark:bg-neutral-900/40 rounded-2xl mx-3 flex items-center justify-center border border-surface-variant/30 dark:border-neutral-800"><div class="text-[16px] sm:text-[18px] font-medium text-on-surface dark:text-gray-100 leading-relaxed whitespace-pre-wrap rich-text-content text-center w-full">${cleanCaptionContent}</div></div>`;
                cleanCaptionContent = ''; // Clear it so it doesn't render twice
            }
        }
        else if (post.post_type === 'image') {
            contentHtml = `<div class="w-full bg-surface-variant/20 dark:bg-neutral-900 flex items-center justify-center border-y border-surface-variant/40 dark:border-neutral-800 mt-2"><img loading="lazy" src="${typeof optimizeImageUrl === 'function' ? optimizeImageUrl(post.media_url, 'feed') : post.media_url}" class="w-full h-auto max-h-[80vh] object-cover"></div>`;
        }
        else if (post.post_type === 'event') {
            const event = Array.isArray(post.post_events) ? post.post_events[0] : post.post_events;
            if (event) {
                const optimizedEventMedia = typeof optimizeImageUrl === 'function' && event.event_image_url ? optimizeImageUrl(event.event_image_url, 'feed') : event.event_image_url;
                const eventImgHtml = event.event_image_url ? `<img loading="lazy" src="${optimizedEventMedia}" class="w-full h-auto max-h-[80vh] object-cover border-y border-surface-variant/40 dark:border-neutral-800 mt-2">` : '';
                const dateStr = event.event_date ? new Date(event.event_date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'TBA';
                
                let actionHtml = '';
                if (event.show_register_btn && event.register_url) {
                    actionHtml = `<a href="${event.register_url}" target="_blank" class="block w-full mt-3 bg-secondary text-white text-center py-2 rounded-xl text-[13px] font-bold active:scale-95 transition-transform">View Link</a>`;
                } else if (event.enable_rsvp) {
                    const rsvps = post.post_event_rsvps || [];
                    const isAttending = !!rsvps.find(r => r.user_id === currentUser.id);
                    const btnClass = isAttending ? 'bg-surface-variant/50 text-on-surface dark:text-gray-100' : 'bg-primary text-white';
                    const btnText = isAttending ? '✓ Attending' : 'RSVP Now';
                    actionHtml = `<button onclick="window.handleRSVP('${post.id}', ${isAttending})" class="block w-full mt-3 ${btnClass} text-center py-2 rounded-xl text-[13px] font-bold active:scale-95 transition-all">${btnText}</button>`;
                }

                contentHtml = `
                    ${eventImgHtml}
                    <div class="px-3 py-3 bg-secondary/5 border-b border-secondary/20 dark:border-neutral-800">
                        <div class="bg-secondary/10 text-secondary w-max px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest mb-2">Upcoming Event</div>
                        <div class="space-y-1">
                            <p class="text-[13px] text-on-surface-variant dark:text-gray-300 flex items-center gap-2 font-medium"><span class="material-symbols-outlined text-[16px]">calendar_today</span> ${dateStr}</p>
                            ${event.event_location ? `<p class="text-[13px] text-on-surface-variant dark:text-gray-300 flex items-center gap-2 font-medium"><span class="material-symbols-outlined text-[16px]">location_on</span> ${event.event_location}</p>` : ''}
                        </div>
                        ${actionHtml}
                    </div>
                `;
            }
        }
        else if (post.post_type === 'poll') {
            const poll = Array.isArray(post.post_polls) ? post.post_polls[0] : post.post_polls;
            if (poll) {
                const currentUserId = currentUser ? currentUser.id : null;
                const isAuthor = currentUserId === post.user_id;
                
                const votes = post.post_poll_votes || [];
                const totalVotes = votes.length;
                const myVotes = votes.filter(v => v.user_id === currentUserId).map(v => v.option_id);
                const userHasVoted = myVotes.length > 0;

                let isExpired = poll.is_ended_early;
                if (!isExpired && poll.deadline_type === 'time' && poll.deadline_time) {
                    isExpired = new Date(poll.deadline_time) < new Date();
                } else if (!isExpired && poll.deadline_type === 'voter_count' && poll.deadline_count) {
                    isExpired = totalVotes >= poll.deadline_count;
                } else if (!isExpired && poll.deadline_type === 'time' && post.expires_at) { 
                    isExpired = new Date(post.expires_at) < new Date();
                }
                
                isPollActive = !isExpired; 
                
                // 🚀 FIX: Separated Results (Percentages) from Quiz Answers (Green/Red Highlights)
                const showResults = userHasVoted || isExpired || isAuthor;
                const showQuizAnswers = userHasVoted || isExpired; // Hide answers from author until they vote or it ends

                const isQuiz = poll.is_quiz;
                const correctOptId = poll.correct_option_id;

                let canVote = true;
                let restrictionReason = '';
                if (!isExpired && !isAuthor) {
                    if (poll.voters_access === 'selected') {
                        if (!poll.allowed_voter_ids || !poll.allowed_voter_ids.includes(currentUserId)) {
                            canVote = false;
                            restrictionReason = '🔒 Voting restricted to Custom List';
                        }
                    }
                }

                if (isExpired) {
                    canVote = false;
                    restrictionReason = '🔒 Poll has ended';
                }

                const optionsHtml = (poll.options || []).map((opt) => {
                    const optVotes = votes.filter(v => v.option_id === opt.id).length;
                    const percentage = totalVotes === 0 ? 0 : Math.round((optVotes / totalVotes) * 100);
                    const iVotedForThis = myVotes.includes(opt.id);
                    
                    let optBorderClass = 'border-surface-variant/50 dark:border-neutral-700';
                    let optBgClass = 'bg-surface-variant/30 dark:bg-surface-variant/10';
                    let checkIconHtml = '';

                    // 🚀 FIX: Only show green/red highlights if showQuizAnswers is true
                    if (isQuiz && showQuizAnswers) {
                        if (opt.id === correctOptId) {
                            optBorderClass = 'border-green-500';
                            optBgClass = 'bg-green-500/10';
                            checkIconHtml = `<span class="material-symbols-outlined text-green-500 text-[18px]">check_circle</span>`;
                        } else if (iVotedForThis) {
                            optBorderClass = 'border-red-500';
                            optBgClass = 'bg-red-500/10';
                            checkIconHtml = `<span class="material-symbols-outlined text-red-500 text-[18px]">cancel</span>`;
                        }
                    } else if (iVotedForThis) {
                        optBorderClass = 'border-primary';
                    }

                    let selectorHtml = '';
                    if (!isQuiz || !showQuizAnswers) { 
                        if (poll.is_multiple_choice) {
                            selectorHtml = `<div class="w-4 h-4 rounded-sm border-2 ${iVotedForThis ? 'border-primary bg-primary flex items-center justify-center' : 'border-surface-variant/80'}">${iVotedForThis ? '<span class="material-symbols-outlined text-white text-[12px] font-bold">check</span>' : ''}</div>`;
                        } else {
                            selectorHtml = `<div class="w-4 h-4 rounded-full border-2 ${iVotedForThis ? 'border-primary flex items-center justify-center' : 'border-surface-variant/80'}">${iVotedForThis ? '<span class="w-2 h-2 rounded-full bg-primary"></span>' : ''}</div>`;
                        }
                    }

                    let clickAction = '';
                    let cursorClass = 'cursor-default';
                    let opacityClass = canVote || iVotedForThis ? 'opacity-100' : 'opacity-60 grayscale-[50%]';

                    if (canVote) {
                        if (iVotedForThis && poll.can_undo_vote) {
                            clickAction = `onclick="window.handlePollVote('${post.id}', '${opt.id}', true)"`;
                            cursorClass = 'cursor-pointer hover:bg-surface-variant/40';
                        } else if (!iVotedForThis && (poll.is_multiple_choice || !userHasVoted || poll.can_undo_vote)) {
                            clickAction = `onclick="window.handlePollVote('${post.id}', '${opt.id}', false)"`;
                            cursorClass = 'cursor-pointer hover:bg-surface-variant/40';
                        }
                    } else if (!canVote && !iVotedForThis) {
                        clickAction = `onclick="import('./ui.js').then(({ showToast }) => showToast('${restrictionReason}', 'warning'))"`;
                    }

                    return `
                    <div ${clickAction} class="relative w-full ${optBgClass} border ${optBorderClass} rounded-xl p-3 overflow-hidden transition-all mb-2 ${cursorClass} ${opacityClass}">
                        <div class="absolute left-0 top-0 bottom-0 bg-primary/20 rounded-r-xl transition-all duration-700 ease-out" style="width: ${showResults && !isQuiz ? percentage : 0}%"></div>
                        <div class="relative flex justify-between items-center text-[13px] font-bold text-on-surface dark:text-gray-100 z-10">
                            <span class="flex items-center gap-2">${selectorHtml} ${opt.text}</span>
                            <div class="flex items-center gap-2">
                                ${checkIconHtml}
                                <span class="${showResults ? 'opacity-100' : 'opacity-0'} transition-opacity">${percentage}%</span>
                            </div>
                        </div>
                    </div>`;
                }).join('');

                let extraInfoHtml = '';
                if (showQuizAnswers && poll.extra_info) { // 🚀 FIX: Explanation only shows when voted/ended
                    extraInfoHtml = `
                        <div class="mt-3 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-[12.5px] text-on-surface dark:text-gray-200 animate-fadeIn">
                            <span class="font-extrabold text-blue-600 dark:text-blue-400 block mb-0.5">${isQuiz ? 'Explanation' : 'Note'}</span>
                            ${poll.extra_info}
                        </div>
                    `;
                }

                let quizBadge = isQuiz ? `<span class="bg-blue-500/10 text-blue-600 dark:text-blue-500 px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-widest mb-2 inline-block shadow-sm">Quiz</span>` : '';
                
                const totalVotesText = poll.voters_list_visibility === 'hidden' && !isAuthor 
                    ? `Votes hidden` 
                    : `<span class="${poll.voters_list_visibility === 'public' || isAuthor ? 'cursor-pointer hover:underline text-primary font-bold' : ''}" onclick="if('${poll.voters_list_visibility}' === 'public' || '${isAuthor}' === 'true') window.openPollVoters('${post.id}')">${totalVotes} votes</span>`;

                let metaLabels = [];
                if (!poll.can_undo_vote) metaLabels.push('🔒 Cannot undo');
                if (poll.deadline_type === 'voter_count') metaLabels.push(`🎯 Target: ${poll.deadline_count}`);
                if (!isExpired && poll.deadline_type === 'time' && poll.deadline_time) metaLabels.push(`⏳ Ends in ${getPollTimeLeft(poll.deadline_time)}`);
                
                const metaHtml = metaLabels.length > 0 ? `<div class="text-[10px] font-bold text-on-surface-variant dark:text-gray-500 mt-3 pt-2 border-t border-surface-variant/30 dark:border-neutral-700 flex flex-wrap gap-x-3 gap-y-1 justify-center">${metaLabels.map(m => `<span>${m}</span>`).join('')}</div>` : '';

                const restrictionBannerHtml = restrictionReason ? `<div class="bg-surface-variant/20 dark:bg-neutral-800/50 text-[11px] font-bold text-on-surface-variant dark:text-gray-400 p-2 rounded-lg mb-3 text-center border border-surface-variant/40 dark:border-neutral-700">${restrictionReason}</div>` : '';

               contentHtml = `
                    <div class="poll-container-wrapper px-3 py-3 border-y border-surface-variant/40 dark:border-neutral-800 bg-surface-variant/5 dark:bg-neutral-900/30 mt-2">
                        ${quizBadge}
                        ${restrictionBannerHtml}
                        <div class="space-y-2 mb-2">${optionsHtml}</div>
                        ${extraInfoHtml}
                        <div class="flex justify-between items-center mt-3 text-[11px] font-medium text-on-surface-variant dark:text-gray-400">
                            ${totalVotesText}
                            <span>${isExpired ? 'Ended' : 'Ongoing'}</span>
                        </div>
                        ${metaHtml}
                    </div>
                `;
            }
        }

        // 🚀 Skip rendering if it's an empty, broken post
        if (contentHtml === '' && cleanCaptionContent === '' && post.post_type === 'text') return '';

        let topCaptionHtml = '';
        let bottomCaptionHtml = '';

        if (cleanCaptionContent !== '') {
            if (post.post_type === 'image') {
                bottomCaptionHtml = `<div class="px-3 text-[14px] text-on-surface dark:text-gray-100 leading-snug mt-1.5 mb-1"><span data-user-id="${user.id}" class="profile-link font-bold mr-1 cursor-pointer hover:underline">${user.full_name}</span><span class="rich-text-content inline">${cleanCaptionContent}</span></div>`;
            } else {
                topCaptionHtml = `<div class="px-3 text-[15px] text-on-surface dark:text-gray-100 leading-snug mt-2 mb-1"><span class="rich-text-content inline">${cleanCaptionContent}</span></div>`;
            }
        }

        return `
        <div data-post-id="${post.id}" class="bg-surface dark:bg-[#121212] mb-6 animate-fadeIn pb-4 border-b border-surface-variant/40 dark:border-neutral-800 relative">

            <div class="flex items-center gap-3 px-3 py-2">
                ${headerIcon}
                <div class="flex-1 min-w-0">
                    <h4 data-user-id="${user.id}" class="profile-link font-bold text-[14px] text-on-surface dark:text-gray-100 leading-tight cursor-pointer hover:text-primary transition-colors flex items-center gap-1 truncate">${user.full_name} ${verifiedBadge}</h4>
                </div>
                <button data-post-id="${post.id}" data-user-id="${user.id}" data-is-verified="${post.is_verified}" data-hide-likes="${post.hide_likes}" data-disable-comments="${post.disable_comments}" data-is-archived="${post.is_archived || false}" data-post-type="${post.post_type}" data-is-poll-active="${isPollActive}" class="post-options-btn text-on-surface dark:text-gray-100 p-1.5 active:opacity-60 transition-opacity">
                    <span class="material-symbols-outlined text-[20px]">more_vert</span>
                </button>
            </div>
            
            ${topCaptionHtml}
            ${contentHtml}
            
            <div class="flex items-center justify-between px-3 py-2 mt-1">
                <div class="flex items-center gap-3.5">
                    <button onclick="window.handleLike('${post.id}', this)" data-post-id="${post.id}" data-liked="${userHasLiked}" class="like-btn flex items-center justify-center transition-all duration-200 active:scale-75 ${userHasLiked ? 'text-red-500 hover:text-red-600' : 'text-on-surface dark:text-gray-100 hover:opacity-70'}">
                        <span class="material-symbols-outlined text-[28px]" style="font-variation-settings: 'FILL' ${userHasLiked ? 1 : 0};">favorite</span> 
                    </button>
                    ${!post.disable_comments ? `
                    <button data-post-id="${post.id}" class="comment-btn flex items-center justify-center text-on-surface dark:text-gray-100 transition-all duration-200 active:scale-75 hover:opacity-70">
                        <span class="material-symbols-outlined text-[26px]" style="transform: scaleX(-1);">chat_bubble_outline</span> 
                    </button>` : ''}
                </div>
                <button onclick="window.handleSavePost('${post.id}', this)" data-post-id="${post.id}" data-saved="${isSaved}" class="save-btn flex items-center justify-center transition-all duration-200 active:scale-75 ${isSaved ? 'text-primary hover:text-primary/80' : 'text-on-surface dark:text-gray-100 hover:opacity-70'}">
                    <span class="material-symbols-outlined text-[28px]" style="font-variation-settings: 'FILL' ${isSaved ? 1 : 0};">bookmark</span>
                </button>
            </div>
            
            ${likeCount > 0 ? `<div class="px-3 mb-1 text-[14px] text-on-surface dark:text-gray-100">${likedByHtml}</div>` : ''}
            
            ${bottomCaptionHtml}
            
            ${commentsSectionHtml}
            <p class="px-3 text-[11px] text-on-surface-variant dark:text-gray-500 mt-2 uppercase tracking-wide">${timeAgo(post.created_at)}</p>
        </div>
        `;
    }).join('');

    if (isRefresh) container.innerHTML = htmlString;
    else container.insertAdjacentHTML('beforeend', htmlString);
}
window._likeLocks = window._likeLocks || {};

window.handleLike = async function(postId, btnElement) {
    if (!currentUser || window._likeLocks[postId]) return; 
    if (!window.checkVerification('like posts')) return;
    window._likeLocks[postId] = true;
    
    const isLiked = btnElement.classList.contains('text-red-500');
    const nextLikedState = !isLiked;

    const likeBtns = document.querySelectorAll(`.like-btn[data-post-id="${postId}"]`);
    
    likeBtns.forEach(likeBtn => {
        likeBtn.dataset.liked = nextLikedState.toString();

        const container = likeBtn.parentElement.parentElement.parentElement; 
        const countSpan = container ? container.querySelector('.like-count-text') : null;
        const iconSpan = likeBtn.querySelector('.material-symbols-outlined');
        
        if (countSpan) {
            let currentCount = parseInt(countSpan.textContent.trim()) || 0;
            countSpan.textContent = nextLikedState ? currentCount + 1 : Math.max(0, currentCount - 1);
        }
        
        if (iconSpan) {
            if (nextLikedState) {
                likeBtn.classList.remove('text-on-surface', 'dark:text-gray-100', 'hover:text-on-surface-variant');
                likeBtn.classList.add('text-red-500');
                iconSpan.style.fontVariationSettings = "'FILL' 1";
                iconSpan.classList.remove('animate-[pulse_0.3s_ease-out]');
                void iconSpan.offsetWidth; 
                iconSpan.classList.add('animate-[pulse_0.3s_ease-out]');
            } else {
                likeBtn.classList.remove('text-red-500');
                likeBtn.classList.add('text-on-surface', 'dark:text-gray-100', 'hover:text-on-surface-variant');
                iconSpan.style.fontVariationSettings = "'FILL' 0";
                iconSpan.classList.remove('animate-[pulse_0.3s_ease-out]');
            }
        }
    });

    const likedPanel = document.getElementById('panel-liked-posts');
    if (!nextLikedState && likedPanel && !likedPanel.classList.contains('translate-x-full')) {
        const postCard = btnElement.closest(`div[data-post-id="${postId}"]`);
        if (postCard) {
            postCard.style.transition = 'all 0.3s ease';
            postCard.style.transform = 'scale(0.9)';
            postCard.style.opacity = '0';
            setTimeout(() => postCard.remove(), 300);
        }
    }
    
    try {
        if (!navigator.onLine) {
            // 🚀 OFFLINE QUEUE
            await queueOfflineAction('like_post', { postId, userId: currentUser.id, isLiked });
        } else {
            // NORMAL ONLINE SYNC
            if (!nextLikedState) {
                await supabase.from('post_likes').delete().match({ post_id: postId, user_id: currentUser.id });
            } else {
                const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: currentUser.id });
                if (error && error.code !== '23505') throw error; 
            }
        }
    } catch (error) {
        console.error("Like error:", error);
    } finally {
        setTimeout(() => { window._likeLocks[postId] = false; }, 300);
    }
};

window.handlePollVote = async function(postId, optionId, isUndo) {
    if (!window.checkVerification('vote on polls')) return; 
    if (isVoting) return; 
    isVoting = true;
    
    const postEl = document.querySelector(`div[data-post-id="${postId}"]`);
    if (postEl) postEl.style.opacity = '0.6';

    try {
        if (!navigator.onLine) {
            // 🚀 OFFLINE QUEUE
            await queueOfflineAction('poll_vote', { postId, userId: currentUser.id, optionId, isUndo });
            import('./ui.js').then(({ showToast }) => showToast(isUndo ? 'Vote removal saved offline.' : 'Vote saved offline.', 'info'));
        } else {
            // NORMAL ONLINE SYNC
            const { error } = await supabase.rpc('cast_poll_vote', {
                p_post_id: postId,
                p_user_id: currentUser.id, 
                p_option_id: String(optionId),
                p_is_undo: isUndo
            });

            if (error) {
                import('./ui.js').then(({ showToast }) => showToast(error.message, 'error'));
                throw error;
            }

            if (typeof window.updatePollUI === 'function') {
                await window.updatePollUI(postId);
            } else if (typeof window.refreshMainFeed === 'function') {
                await window.refreshMainFeed(); 
            }
        }
    } catch (error) {
        console.error("Poll vote error:", error);
    } finally {
        if (postEl) postEl.style.opacity = '1';
        isVoting = false; 
    }
};
// 🚀 SMOOTH UPDATE ENGINE
window.updatePollUI = async function(postId) {
    const postEls = document.querySelectorAll(`div[data-post-id="${postId}"]`);
    if (!postEls.length) return;
    
    try {
        const [pollRes, votesRes, postRes] = await Promise.all([
            supabase.from('post_polls').select('*').eq('post_id', postId).single(),
            supabase.from('post_poll_votes').select('*').eq('post_id', postId),
            supabase.from('posts').select('expires_at, user_id').eq('id', postId).single()
        ]);

        if (pollRes.error || postRes.error) return;

        const poll = pollRes.data;
        const votes = votesRes.data || [];
        const post = postRes.data;
        const currentUserId = currentUser ? currentUser.id : null;
        const isAuthor = currentUserId === post.user_id;

        const totalVotes = votes.length;
        const myVotes = votes.filter(v => v.user_id === currentUserId).map(v => v.option_id);
        const userHasVoted = myVotes.length > 0;

        let isExpired = poll.is_ended_early;
        if (!isExpired && poll.deadline_type === 'time' && poll.deadline_time) {
            isExpired = new Date(poll.deadline_time) < new Date();
        } else if (!isExpired && poll.deadline_type === 'voter_count' && poll.deadline_count) {
            isExpired = totalVotes >= poll.deadline_count;
        } else if (!isExpired && poll.deadline_type === 'time' && post.expires_at) { 
            isExpired = new Date(post.expires_at) < new Date();
        }

        const showResults = userHasVoted || isExpired || isAuthor;
        const showQuizAnswers = userHasVoted || isExpired; // 🚀 Hide from author until voted/ended

        const isQuiz = poll.is_quiz;
        const correctOptId = poll.correct_option_id;

        let canVote = true;
        let restrictionReason = '';
        if (!isExpired && !isAuthor) {
            if (poll.voters_access === 'selected') {
                if (!poll.allowed_voter_ids || !poll.allowed_voter_ids.includes(currentUserId)) {
                    canVote = false;
                    restrictionReason = '🔒 Voting restricted to Custom List';
                }
            }
        }
        if (isExpired) {
            canVote = false;
            restrictionReason = '🔒 Poll has ended';
        }

        const optionsHtml = (poll.options || []).map((opt) => {
            const optVotes = votes.filter(v => v.option_id === opt.id).length;
            const percentage = totalVotes === 0 ? 0 : Math.round((optVotes / totalVotes) * 100);
            const iVotedForThis = myVotes.includes(opt.id);
            
            let optBorderClass = 'border-surface-variant/50 dark:border-neutral-700';
            let optBgClass = 'bg-surface-variant/30 dark:bg-surface-variant/10';
            let checkIconHtml = '';

            if (isQuiz && showQuizAnswers) {
                if (opt.id === correctOptId) {
                    optBorderClass = 'border-green-500';
                    optBgClass = 'bg-green-500/10';
                    checkIconHtml = `<span class="material-symbols-outlined text-green-500 text-[18px]">check_circle</span>`;
                } else if (iVotedForThis) {
                    optBorderClass = 'border-red-500';
                    optBgClass = 'bg-red-500/10';
                    checkIconHtml = `<span class="material-symbols-outlined text-red-500 text-[18px]">cancel</span>`;
                }
            } else if (iVotedForThis) {
                optBorderClass = 'border-primary';
            }

            let selectorHtml = '';
            if (!isQuiz || !showQuizAnswers) { 
                if (poll.is_multiple_choice) {
                    selectorHtml = `<div class="w-4 h-4 rounded-sm border-2 ${iVotedForThis ? 'border-primary bg-primary flex items-center justify-center' : 'border-surface-variant/80'}">${iVotedForThis ? '<span class="material-symbols-outlined text-white text-[12px] font-bold">check</span>' : ''}</div>`;
                } else {
                    selectorHtml = `<div class="w-4 h-4 rounded-full border-2 ${iVotedForThis ? 'border-primary flex items-center justify-center' : 'border-surface-variant/80'}">${iVotedForThis ? '<span class="w-2 h-2 rounded-full bg-primary"></span>' : ''}</div>`;
                }
            }

            let clickAction = '';
            let cursorClass = 'cursor-default';
            let opacityClass = canVote || iVotedForThis ? 'opacity-100' : 'opacity-60 grayscale-[50%]';

            if (canVote) {
                if (iVotedForThis && poll.can_undo_vote) {
                    clickAction = `onclick="window.handlePollVote('${postId}', '${opt.id}', true)"`;
                    cursorClass = 'cursor-pointer hover:bg-surface-variant/40';
                } else if (!iVotedForThis && (poll.is_multiple_choice || !userHasVoted || poll.can_undo_vote)) {
                    clickAction = `onclick="window.handlePollVote('${postId}', '${opt.id}', false)"`;
                    cursorClass = 'cursor-pointer hover:bg-surface-variant/40';
                }
            } else if (!canVote && !iVotedForThis) {
                clickAction = `onclick="import('./ui.js').then(({ showToast }) => showToast('${restrictionReason}', 'warning'))"`;
            }

            return `
            <div ${clickAction} class="relative w-full ${optBgClass} border ${optBorderClass} rounded-xl p-3 overflow-hidden transition-all mb-2 ${cursorClass} ${opacityClass}">
                <div class="absolute left-0 top-0 bottom-0 bg-primary/20 rounded-r-xl transition-all duration-700 ease-out" style="width: ${showResults && !isQuiz ? percentage : 0}%"></div>
                <div class="relative flex justify-between items-center text-[13px] font-bold text-on-surface dark:text-gray-100 z-10">
                    <span class="flex items-center gap-2">${selectorHtml} ${opt.text}</span>
                    <div class="flex items-center gap-2">
                        ${checkIconHtml}
                        <span class="${showResults ? 'opacity-100' : 'opacity-0'} transition-opacity">${percentage}%</span>
                    </div>
                </div>
            </div>`;
        }).join('');

        let extraInfoHtml = '';
        if (showQuizAnswers && poll.extra_info) {
            extraInfoHtml = `
                <div class="mt-3 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-[12.5px] text-on-surface dark:text-gray-200 animate-fadeIn">
                    <span class="font-extrabold text-blue-600 dark:text-blue-400 block mb-0.5">${isQuiz ? 'Explanation' : 'Note'}</span>
                    ${poll.extra_info}
                </div>
            `;
        }

        let quizBadge = isQuiz ? `<span class="bg-blue-500/10 text-blue-600 dark:text-blue-500 px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-widest mb-2 inline-block shadow-sm">Quiz</span>` : '';
        
        const totalVotesText = poll.voters_list_visibility === 'hidden' && !isAuthor 
            ? `Votes hidden` 
            : `<span class="${poll.voters_list_visibility === 'public' || isAuthor ? 'cursor-pointer hover:underline text-primary font-bold' : ''}" onclick="if('${poll.voters_list_visibility}' === 'public' || '${isAuthor}' === 'true') window.openPollVoters('${postId}')">${totalVotes} votes</span>`;

        let metaLabels = [];
        if (!poll.can_undo_vote) metaLabels.push('🔒 Cannot undo');
        if (poll.deadline_type === 'voter_count') metaLabels.push(`🎯 Target: ${poll.deadline_count}`);
        if (!isExpired && poll.deadline_type === 'time' && poll.deadline_time) metaLabels.push(`⏳ Ends in ${getPollTimeLeft(poll.deadline_time)}`);
        
        const metaHtml = metaLabels.length > 0 ? `<div class="text-[10px] font-bold text-on-surface-variant dark:text-gray-500 mt-3 pt-2 border-t border-surface-variant/30 dark:border-neutral-700 flex flex-wrap gap-x-3 gap-y-1 justify-center">${metaLabels.map(m => `<span>${m}</span>`).join('')}</div>` : '';

        const restrictionBannerHtml = restrictionReason ? `<div class="bg-surface-variant/20 dark:bg-neutral-800/50 text-[11px] font-bold text-on-surface-variant dark:text-gray-400 p-2 rounded-lg mb-3 text-center border border-surface-variant/40 dark:border-neutral-700">${restrictionReason}</div>` : '';

        postEls.forEach(postEl => {
            const pollContainer = postEl.querySelector('.poll-container-wrapper');
            if (pollContainer) {
                pollContainer.innerHTML = `
                    ${quizBadge}
                    ${restrictionBannerHtml}
                    <div class="space-y-2 mb-2">${optionsHtml}</div>
                    ${extraInfoHtml}
                    <div class="flex justify-between items-center mt-3 text-[11px] font-medium text-on-surface-variant dark:text-gray-400">
                        ${totalVotesText}
                        <span>${isExpired ? 'Ended' : 'Ongoing'}</span>
                    </div>
                    ${metaHtml}
                `;
            }
            
            // 🚀 FIX: Update the 3-dot menu data so "End Poll" disappears instantly!
            const optionsBtn = postEl.querySelector('.post-options-btn');
            if (optionsBtn) {
                optionsBtn.dataset.isPollActive = (!isExpired).toString();
            }
        });
    } catch(e) {
        console.error("Poll update error:", e);
    }
};

window.openPollVoters = async (postId, optionId = null) => {
    const modal = document.getElementById('modal-poll-voters');
    const list = document.getElementById('poll-voters-list');
    if (!modal || !list) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">Loading voters...</p>`;

    try {
        let query = supabase
            .from('post_poll_votes')
            .select('users(id, full_name, profile_img_url, tick_type)')
            .eq('post_id', postId);
            
        if (optionId) {
            query = query.eq('option_id', optionId);
        }

        const { data, error } = await query;
        if (error) throw error;

        const uniqueUsers = [];
        const seenIds = new Set();
        for (const v of data) {
            if (v.users && !seenIds.has(v.users.id)) {
                seenIds.add(v.users.id);
                uniqueUsers.push(v.users);
            }
        }

        if (uniqueUsers.length === 0) {
            list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">No votes yet.</p>`;
            return;
        }

        const getTick = (type) => window.getTickHtml ? window.getTickHtml(type) : '';

        list.innerHTML = uniqueUsers.map(u => `
            <div class="flex items-center gap-3 p-3 hover:bg-surface-variant/20 dark:hover:bg-neutral-800/50 rounded-2xl transition-colors active:scale-[0.98]">
                <div class="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onclick="document.getElementById('modal-poll-voters').classList.replace('flex','hidden'); setTimeout(() => window.viewUserProfile('${u.id}'), 200);">
                    <img src="${u.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.full_name)}&background=e1e3e4`}" class="w-11 h-11 rounded-full object-cover border border-surface-variant/50 dark:border-neutral-800 shadow-sm shrink-0">
                    <div class="flex-1 min-w-0 truncate">
                        <p class="text-[14.5px] font-extrabold text-on-surface dark:text-gray-100 flex items-center gap-1">${u.full_name} ${getTick(u.tick_type)}</p>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = `<p class="text-sm italic text-center py-8 text-error">Failed to load voters. The list might be hidden.</p>`;
        console.error("Voters load error:", e);
    }
};

function openCommentOptions(commentId, commentOwnerId) {
    const isOwner = currentUser.id === commentOwnerId;
    let buttonsHtml = '';

    if (isOwner) {
        buttonsHtml = `
            <button onclick="window.deleteComment('${commentId}')" class="w-full flex items-center gap-3 p-4 bg-error/10 text-error rounded-2xl font-bold active:scale-95 transition-transform">
                <span class="material-symbols-outlined">delete</span> Delete Comment
            </button>
        `;
    } else {
        buttonsHtml = `<p class="text-sm text-center text-on-surface-variant">No actions available.</p>`;
    }

    window.openActionSheet(buttonsHtml);
}

window.deletePost = function(postId) {
    if (typeof window.closePopupMenu === 'function') window.closePopupMenu();

    const modal = document.getElementById('modal-confirm-action');
    if (!modal) return;

    document.getElementById('confirm-action-title').textContent = "Delete Post?";
    document.getElementById('confirm-action-message').textContent = "This will permanently remove this post from your feed and profile.";

    modal.classList.replace('hidden', 'flex');

    const confirmBtn = document.getElementById('confirm-action-yes');
    const cancelBtn = document.getElementById('confirm-action-no');

    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newCancelBtn.addEventListener('click', () => {
        modal.classList.replace('flex', 'hidden');
    });

    newConfirmBtn.addEventListener('click', async () => {
        modal.classList.replace('flex', 'hidden');
        showToast('Deleting post...', 'info');

        const postElements = document.querySelectorAll(`div[data-post-id="${postId}"]`);
        postElements.forEach(el => el.style.display = 'none');

        const { error } = await supabase.from('posts').update({ is_deleted: true }).eq('id', postId);

        if (error) {
            console.error('Supabase Delete Error:', error);
            postElements.forEach(el => el.style.display = 'block'); 
            showToast('Failed to delete post.', 'error');
        } else {
            showToast('Post deleted.', 'success');
            postElements.forEach(el => el.remove()); 
        }
    });
};

window.openReportPostModal = (postId) => {
    window.closePopupMenu();
    const modal = document.getElementById('modal-report-post');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
    const btn = document.getElementById('submit-report-post-btn');
    if (btn) btn.dataset.postId = postId;
};

window.closeReportPostModal = () => {
    const modal = document.getElementById('modal-report-post');
    if (modal) {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
    }
    const reason = document.getElementById('report-post-reason');
    if (reason) reason.value = '';
    const label = document.getElementById('report-reason-label');
    if (label) {
        label.textContent = '-- Select a reason --';
        label.classList.add('text-on-surface-variant', 'dark:text-gray-400');
        label.classList.remove('text-on-surface', 'dark:text-gray-100', 'font-medium');
    }
    const desc = document.getElementById('report-post-description');
    if (desc) desc.value = '';
};

async function submitPostReport() {
    const btn = document.getElementById('submit-report-post-btn');
    const postId = btn?.dataset.postId;
    const reason = document.getElementById('report-post-reason')?.value;
    const desc = document.getElementById('report-post-description')?.value.trim();

    if (!reason) {
        showToast('Please select a reason.', 'warning');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
        const { error } = await supabase.rpc('report_post', {
            p_reported_post_id: postId,
            p_reason: reason,
            p_description: desc || null
        });
        if (error) throw error;
        
        showToast('Report submitted. Our team will review it.', 'success');
        window.closeReportPostModal();
    } catch (error) {
        showToast(error.message || 'Failed to submit report.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Report';
    }
}

function handleTouchMove(e) {
    let moveX, moveY;

    if (e.touches && e.touches.length > 0) {
        moveX = e.touches[0].clientX;
        moveY = e.touches[0].clientY;
    } else if (e.clientX !== undefined) {
        moveX = e.clientX;
        moveY = e.clientY;
    } else {
        return; 
    }
    
    if (Math.abs(moveX - touchStartX) > 20 || Math.abs(moveY - touchStartY) > 20) {
        clearTimeout(longPressTimer);
    }
}

// COMMENTS 
window.closeCommentsModal = function() {
    const modal = document.getElementById('modal-post-comments');
    const bottomNav = document.querySelector('nav');
    
    if (modal) modal.classList.add('translate-x-full');
    
    setTimeout(() => {
        if (modal) modal.classList.replace('flex', 'hidden');
        if (bottomNav) {
            bottomNav.style.display = ''; 
            bottomNav.classList.remove('hidden'); 
        }
    }, 300);
    
    if (typeof window.cancelReply === 'function') window.cancelReply();
    const input = document.getElementById('post-comment-input');
    if (input) { input.value = ''; input.style.height = 'auto'; }
    currentMentionIds = [];
};

let activeReplyCommentId = null;
let currentMentionIds = [];

window.cancelReply = function() {
    activeReplyCommentId = null;
    const indicator = document.getElementById('replying-to-indicator');
    if (indicator) indicator.classList.add('hidden');
    const input = document.getElementById('post-comment-input');
    if (input) input.focus();
};

window.prepareReply = function(commentId, userName) {
    activeReplyCommentId = commentId;
    const nameEl = document.getElementById('replying-to-name');
    if (nameEl) nameEl.textContent = userName;
    const indicator = document.getElementById('replying-to-indicator');
    if (indicator) indicator.classList.remove('hidden');
    
    const input = document.getElementById('post-comment-input');
    if (input) {
        input.value = `@${userName} `; 
        input.focus();
    }
    const sendBtn = document.getElementById('send-comment-btn');
    if (sendBtn) sendBtn.disabled = false;
};

document.getElementById('post-comment-input')?.addEventListener('input', function(e) {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    
    const sendBtn = document.getElementById('send-comment-btn');
    if (sendBtn) sendBtn.disabled = this.value.trim() === '';
    handleNativeMentions(this.value, this);
});

let nativeMentionTimeout = null;

async function handleNativeMentions(text) {
    const list = document.getElementById('comment-mention-list');
    if (!list) return;

    const match = text.match(/@([a-zA-Z0-9_]+)$/); 
    
    if (match) {
        const query = match[1];
        list.classList.remove('hidden');
        list.innerHTML = `<p class="text-xs text-center py-2 text-gray-500">Searching...</p>`;
        
        clearTimeout(nativeMentionTimeout);
        
        nativeMentionTimeout = setTimeout(async () => {
            try {
                const { data, error } = await supabase.rpc('search_mentionable_users', {
                p_search_term: query,
                p_current_user_id: currentUser.id
            });
            if (error) throw error;
            
            if (data.length === 0) {
                list.innerHTML = `<p class="text-xs text-center py-2 text-gray-500">No users found</p>`;
                return;
            }
            
            list.innerHTML = data.map(u => `
                <div onclick="window.insertMention('${u.id}', '${u.full_name}')" class="flex items-center gap-3 p-3 hover:bg-surface-variant/30 cursor-pointer transition-colors active:scale-[0.98]">
                    <img src="${u.profile_img_url}" class="w-8 h-8 rounded-full object-cover">
                    <span class="text-[13px] font-bold text-on-surface dark:text-gray-100">${u.full_name}</span>
                </div>
            `).join('');
        } catch (e) {
            list.classList.add('hidden');
        }
    });
    } else {
        list.classList.add('hidden');
    }
}

window.insertMention = function(userId, fullName) {
    const input = document.getElementById('post-comment-input');
    if (input) {
        const safeName = fullName.replace(/ /g, '\u00A0'); 
        input.value = input.value.replace(/@[a-zA-Z0-9_]+$/, `@${safeName} `);
        currentMentionIds.push(userId); 
        input.focus();
    }
    const list = document.getElementById('comment-mention-list');
    if (list) list.classList.add('hidden');
};

window.openCommentsModal = async function(postId) {
    const modal = document.getElementById('modal-post-comments');
    const list = document.getElementById('post-comments-list');
    const input = document.getElementById('post-comment-input');
    const bottomNav = document.querySelector('nav'); 
    
    const myAvatar = document.getElementById('current-user-comment-avatar');
    if (myAvatar && currentUser) {
        myAvatar.src = typeof optimizeImageUrl === 'function' ? optimizeImageUrl(currentUser.profile_img_url, 'avatar') : currentUser.profile_img_url;
    }
    
    const sendBtn = document.getElementById('send-comment-btn');
    if (sendBtn) sendBtn.dataset.postId = postId;
    window.cancelReply(); 
    if (input) {
        input.value = '';
        input.style.height = 'auto';
    }
    currentMentionIds = [];

    if (bottomNav) bottomNav.style.display = 'none'; 
    if (modal) {
        modal.classList.replace('hidden', 'flex');
        setTimeout(() => modal.classList.remove('translate-x-full'), 10);
    }
    
    if (list) list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">Loading comments...</p>`;

    try {
        const { data, error } = await supabase.from('post_comments')
            .select('*, users(id, full_name, profile_img_url, tick_type), comment_likes(user_id)')
            .eq('post_id', postId).eq('is_deleted', false).order('created_at', { ascending: true });
            
        if (error) throw error;

        if (data.length === 0) {
            if (list) list.innerHTML = `<div class="py-10 flex flex-col items-center opacity-40"><span class="material-symbols-outlined text-[42px] mb-2">chat_bubble</span><p class="text-[14px] font-bold">No comments yet.</p><p class="text-[12px]">Start the conversation.</p></div>`;
            return;
        }

        const parents = data.filter(c => !c.parent_comment_id);
        const replies = data.filter(c => c.parent_comment_id);

        if (list) {
            list.innerHTML = parents.map(comment => {
                const commentReplies = replies.filter(r => r.parent_comment_id === comment.id);
                return renderSingleComment(comment, false) + commentReplies.map(r => renderSingleComment(r, true)).join('');
            }).join('');
        }

    } catch (error) {
        if (list) list.innerHTML = `<p class="text-sm italic text-center py-8 text-error">Failed to load comments.</p>`;
    }
};

function renderSingleComment(comment, isReply) {
    const paddingLeft = isReply ? 'ml-12' : ''; 
    const parentIdAttr = isReply ? `data-parent-id="${comment.parent_comment_id}"` : '';
    
    let formattedContent = comment.content.replace(/@([\w\u00A0]+)/g, '<span onclick="event.stopPropagation(); window.searchAndOpenProfile(\'$1\')" class="text-primary font-bold hover:underline cursor-pointer select-none">@$1</span>');
    formattedContent = formattedContent.replace(/\u00A0/g, ' ');

    const isLiked = comment.comment_likes && comment.comment_likes.some(like => like.user_id === currentUser.id);
    const likeCount = comment.comment_likes ? comment.comment_likes.length : 0;
    const heartClass = isLiked ? 'text-red-500' : 'text-on-surface-variant dark:text-gray-500';
    const heartFill = isLiked ? '1' : '0';

    return `
        <div class="flex items-start gap-3 mb-4 ${paddingLeft}" data-comment-id="${comment.id}" ${parentIdAttr}>
            <img onclick="window.closeCommentsModal(); setTimeout(() => window.viewUserProfile('${comment.users.id}'), 200);" src="${comment.users.profile_img_url}" class="w-8 h-8 rounded-full object-cover shrink-0 cursor-pointer mt-1 border border-surface-variant/50">
            
            <div class="comment-body flex-1 min-w-0 flex flex-col cursor-pointer select-none active:opacity-60 transition-opacity" 
                 data-comment-id="${comment.id}" 
                 data-comment-owner-id="${comment.user_id}"
                 oncontextmenu="event.preventDefault(); window.openCommentActionSheet('${comment.id}', '${comment.user_id}'); return false;">
                 
                <p class="text-[13px] text-on-surface dark:text-gray-100 leading-snug">
                    <span onclick="event.stopPropagation(); window.closeCommentsModal(); setTimeout(() => window.viewUserProfile('${comment.users.id}'), 200);" class="font-extrabold mr-1 hover:underline text-on-surface dark:text-gray-100">${comment.users.full_name}</span>
                    ${formattedContent}
                </p>
                <div class="flex items-center gap-4 mt-1">
                    <span class="text-[11px] font-bold text-on-surface-variant dark:text-gray-500">${timeAgo(comment.created_at)}</span>
                    <span onclick="event.stopPropagation(); window.prepareReply('${isReply ? comment.parent_comment_id : comment.id}', '${comment.users.full_name}')" class="text-[11px] font-bold text-on-surface-variant dark:text-gray-500 hover:text-primary transition-colors">Reply</span>
                </div>
            </div>

            <div class="flex flex-col items-center justify-start ml-2 mt-1 shrink-0">
                <button onclick="window.handleCommentLike('${comment.id}', this)" class="${heartClass} hover:text-red-500 transition-colors active:scale-90 flex flex-col items-center px-2 pt-1 pb-0.5">
                    <span class="material-symbols-outlined text-[14px]" style="font-variation-settings: 'FILL' ${heartFill};">favorite</span>
                </button>
                ${likeCount > 0 ? `<span class="comment-like-count text-[10px] font-medium text-on-surface-variant dark:text-gray-500">${likeCount}</span>` : ''}
            </div>
        </div>
    `;
}

window.openCommentActionSheet = function(commentId, commentOwnerId) {
    if (typeof longPressTimer !== 'undefined') clearTimeout(longPressTimer);
    window.isLongPressing = false;

    const isOwner = currentUser.id === commentOwnerId;
    const card = document.getElementById('comment-options-card');
    const highlightContainer = document.getElementById('highlighted-comment-container');
    
    const originalComment = document.querySelector(`div[data-comment-id="${commentId}"]`);
    if (originalComment && highlightContainer) {
        const clone = originalComment.cloneNode(true);
        clone.className = "flex items-start gap-3"; 
        const likeBtn = clone.querySelector('button');
        if (likeBtn) likeBtn.parentElement.remove();
        highlightContainer.innerHTML = '';
        highlightContainer.appendChild(clone);
    }

    let buttonsHtml = '';
    if (isOwner) {
        buttonsHtml = `
            <button class="w-full flex items-center gap-4 px-5 py-4 hover:bg-surface-variant/30 dark:hover:bg-white/5 font-semibold text-on-surface dark:text-gray-100 transition-colors border-b border-surface-variant/50 dark:border-white/10 text-[15px]">
                <span class="material-symbols-outlined text-[24px]">send</span> Share
            </button>
            <button onclick="window.deleteComment('${commentId}')" class="w-full flex items-center gap-4 px-5 py-4 hover:bg-surface-variant/30 dark:hover:bg-white/5 font-semibold text-error transition-colors text-[15px]">
                <span class="material-symbols-outlined text-[24px]">delete</span> Delete
            </button>
        `;
    } else {
        buttonsHtml = `
            <button class="w-full flex items-center gap-4 px-5 py-4 hover:bg-surface-variant/30 dark:hover:bg-white/5 font-semibold text-on-surface dark:text-gray-100 transition-colors border-b border-surface-variant/50 dark:border-white/10 text-[15px]">
                <span class="material-symbols-outlined text-[24px]">send</span> Share
            </button>
            <button class="w-full flex items-center gap-4 px-5 py-4 hover:bg-orange-500/10 dark:hover:bg-white/5 font-semibold text-orange-500 transition-colors text-[15px]">
                <span class="material-symbols-outlined text-[24px]">flag</span> Report
            </button>
        `;
    }

    if (card) card.innerHTML = buttonsHtml;

    const modal = document.getElementById('modal-comment-options');
    const wrapper = document.getElementById('comment-options-wrapper');
    if (modal && wrapper) {
        modal.classList.replace('hidden', 'flex');
        modal.style.pointerEvents = 'auto';
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            wrapper.classList.remove('scale-95');
        }, 10);
    }
};

async function submitComment(postId) {
    if (!window.checkVerification('comment on posts')) return; 
    
    const input = document.getElementById('post-comment-input');
    const content = input ? input.value.trim() : '';
    if (!content) return;

    const btn = document.getElementById('send-comment-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>`;
    }

    const payload = {
        post_id: postId,
        user_id: currentUser.id,
        content: content,
        mentioned_user_ids: currentMentionIds
    };
    if (activeReplyCommentId) payload.parent_comment_id = activeReplyCommentId;

    try {
        if (!navigator.onLine) {
            // 🚀 OFFLINE QUEUE
            await queueOfflineAction('comment_post', payload);
            import('./ui.js').then(({ showToast }) => showToast('Comment saved offline. Will post when reconnected.', 'info'));
            
            if (input) {
                input.value = '';
                input.style.height = 'auto';
            }
            window.cancelReply();
            currentMentionIds = [];
            window.closeCommentsModal();
        } else {
            // NORMAL ONLINE SYNC
            const { error } = await supabase.from('post_comments').insert(payload);
            if (error) throw error;

            if (input) {
                input.value = '';
                input.style.height = 'auto';
            }
            window.cancelReply();
            currentMentionIds = [];
            
            openCommentsModal(postId); 
            
            const commentBtns = document.querySelectorAll(`.comment-btn[data-post-id="${postId}"]`);
            commentBtns.forEach(commentBtn => {
                const html = commentBtn.innerHTML;
                if (html.includes('View')) {
                    const countMatch = html.match(/\d+/);
                    if (countMatch) {
                        commentBtn.innerHTML = `View all ${parseInt(countMatch[0]) + 1} comments`;
                    } else if (html.includes('View 1 comment')) {
                        commentBtn.innerHTML = `View all 2 comments`;
                    }
                }
            });
        }
    } catch (error) {
        import('./ui.js').then(({ showToast }) => showToast('Failed to post comment.', 'error'));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'Post';
        }
    }
}

window.closeCommentActionSheet = function() {
    const modal = document.getElementById('modal-comment-options');
    const wrapper = document.getElementById('comment-options-wrapper');
    
    if (modal && wrapper) {
        modal.style.pointerEvents = 'none';
        modal.classList.add('opacity-0');
        wrapper.classList.add('scale-95');
        setTimeout(() => modal.classList.replace('flex', 'hidden'), 200);
    }
};

window.deleteComment = async (commentId) => {
    window.closeCommentActionSheet();
    
    const commentEl = document.querySelector(`div[data-comment-id="${commentId}"]`);
    const replyEls = document.querySelectorAll(`div[data-parent-id="${commentId}"]`);
    
    const elementsToRemove = [commentEl, ...Array.from(replyEls)].filter(Boolean);
    elementsToRemove.forEach(el => {
        el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.95)';
        setTimeout(() => el.style.display = 'none', 200); 
        setTimeout(() => el.remove(), 300); 
    });

    const [mainRes] = await Promise.all([
        supabase.from('post_comments').update({ is_deleted: true }).eq('id', commentId),
        supabase.from('post_comments').update({ is_deleted: true }).eq('parent_comment_id', commentId)
    ]);
    
    if (mainRes.error) {
        elementsToRemove.forEach(el => { el.style.display = 'flex'; el.style.opacity = '1'; el.style.transform = 'scale(1)'; });
        showToast('Failed to delete comment.', 'error');
    } else {
        showToast('Comment deleted.', 'success');
    }
};

window._commentLikeLocks = window._commentLikeLocks || {};

window.handleCommentLike = async function(commentId, btnElement) {
    if (window._commentLikeLocks[commentId]) return;
    window._commentLikeLocks[commentId] = true;

    const iconSpan = btnElement.querySelector('.material-symbols-outlined');
    const isLiked = btnElement.classList.contains('text-red-500');
    let countSpan = btnElement.parentElement.querySelector('.comment-like-count');
    
    if (isLiked) {
        btnElement.classList.remove('text-red-500');
        btnElement.classList.add('text-on-surface-variant', 'dark:text-gray-500');
        if (iconSpan) iconSpan.style.fontVariationSettings = "'FILL' 0";
        
        if (countSpan) {
            let count = parseInt(countSpan.textContent) || 1;
            if (count <= 1) countSpan.remove();
            else countSpan.textContent = count - 1;
        }
    } else {
        btnElement.classList.remove('text-on-surface-variant', 'dark:text-gray-500');
        btnElement.classList.add('text-red-500');
        if (iconSpan) {
            iconSpan.style.fontVariationSettings = "'FILL' 1";
            iconSpan.classList.remove('animate-[pulse_0.3s_ease-out]');
            void iconSpan.offsetWidth; 
            iconSpan.classList.add('animate-[pulse_0.3s_ease-out]');
        }
        
        if (countSpan) {
            countSpan.textContent = (parseInt(countSpan.textContent) || 0) + 1;
        } else {
            btnElement.parentElement.insertAdjacentHTML('beforeend', `<span class="comment-like-count text-[10px] font-medium text-on-surface-variant dark:text-gray-500">1</span>`);
        }
    }

    try {
        if (isLiked) {
            await supabase.from('comment_likes').delete().match({ comment_id: commentId, user_id: currentUser.id });
        } else {
            const { error } = await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: currentUser.id });
            if (error && error.code !== '23505') throw error; 
        }
    } catch(e) { 
        console.error(e); 
    } finally {
        setTimeout(() => { window._commentLikeLocks[commentId] = false; }, 300);
    }
};

function setupLikesModalTouchPhysics() {
    const card = document.getElementById('likes-modal-card');
    if (!card) return;

    let panelStartY = 0;
    let isDraggingPanel = false;
    let isPanelScrollable = false;

    card.addEventListener('touchstart', (e) => {
        const scrollArea = e.target.closest('.overflow-y-auto');
        if (scrollArea && scrollArea.scrollTop > 0) {
            isPanelScrollable = true;
            isDraggingPanel = false;
        } else {
            isPanelScrollable = false;
            panelStartY = e.touches[0].clientY;
            isDraggingPanel = true;
            card.style.transition = 'none'; 
        }
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
        if (isPanelScrollable || !isDraggingPanel) return;
        const deltaY = e.touches[0].clientY - panelStartY;
        if (deltaY > 0) {
            card.style.transform = `translateY(${deltaY}px)`;
            if (e.cancelable) e.preventDefault(); 
        }
    }, { passive: false });

    card.addEventListener('touchend', (e) => {
        if (isPanelScrollable || !isDraggingPanel) return;
        isDraggingPanel = false;
        const deltaY = e.changedTouches[0].clientY - panelStartY;
        card.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)'; 
        if (deltaY > 100) {
            window.closeLikesModal();
        } else {
            card.style.transform = ''; 
        }
    }, { passive: true });
}

let currentLikesPostId = null;
let currentLikesPage = 0;
const LIKES_PER_PAGE = 30;

window.openLikesModal = async function(postId, isLoadMore = false) {
    const modal = document.getElementById('modal-likes-list');
    const card = document.getElementById('likes-modal-card');
    const container = document.getElementById('likes-list-container');
    if (!modal || !container) return;

    if (!isLoadMore) {
        currentLikesPostId = postId;
        currentLikesPage = 0;
        modal.classList.replace('hidden', 'flex');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            if (card) {
                card.style.transform = ''; 
                card.classList.remove('translate-y-full');
            }
        }, 10);
        
        const oldBtn = document.getElementById('load-more-likes-btn');
        if (oldBtn) oldBtn.remove();

        container.innerHTML = `
            <div class="flex items-center gap-3 p-3 animate-pulse">
                <div class="w-11 h-11 rounded-full bg-surface-variant/50 dark:bg-neutral-800 shrink-0"></div>
                <div class="flex-1 space-y-2">
                    <div class="h-3.5 bg-surface-variant/50 dark:bg-neutral-800 rounded w-1/3"></div>
                    <div class="h-2.5 bg-surface-variant/50 dark:bg-neutral-800 rounded w-1/4"></div>
                </div>
            </div>`.repeat(5);
    } else {
        const loadBtn = document.getElementById('load-more-likes-btn');
        if (loadBtn) loadBtn.innerHTML = `<span class="material-symbols-outlined animate-spin">progress_activity</span>`;
    }

    try {
        const from = currentLikesPage * LIKES_PER_PAGE;
        const to = from + LIKES_PER_PAGE - 1;

        const { data: likes, error } = await supabase
            .from('post_likes')
            .select('users(id, full_name, profile_img_url, tick_type)')
            .eq('post_id', currentLikesPostId)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) throw error;
        
        if (!isLoadMore && likes.length === 0) {
            container.innerHTML = `<div class="py-12 flex flex-col items-center opacity-50"><span class="material-symbols-outlined text-4xl mb-2">favorite</span><p class="text-sm font-bold">No likes yet.</p></div>`;
            return;
        }

        const getTick = (type) => window.getTickHtml ? window.getTickHtml(type) : '';

        const likesHtml = likes.map(like => {
            const u = like.users;
            const avatar = u.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.full_name)}&background=e1e3e4`;
            
            return `
                <div class="flex items-center justify-between p-3 hover:bg-surface-variant/20 dark:hover:bg-neutral-800/50 rounded-2xl transition-colors active:scale-[0.98]">
                    <div class="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onclick="closeLikesModal(); setTimeout(() => viewUserProfile('${u.id}'), 200);">
                        <img src="${avatar}" class="w-11 h-11 rounded-full object-cover border border-surface-variant/50 dark:border-neutral-800 shadow-sm shrink-0">
                        <div class="flex-1 min-w-0 truncate">
                            <p class="text-[14.5px] font-extrabold text-on-surface dark:text-gray-100 flex items-center gap-1">${u.full_name} ${getTick(u.tick_type)}</p>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        if (!isLoadMore) {
            container.innerHTML = likesHtml;
        } else {
            const oldBtn = document.getElementById('load-more-likes-btn');
            if (oldBtn) oldBtn.remove();
            container.insertAdjacentHTML('beforeend', likesHtml);
        }

        // Add "Load More" button if we hit the limit
        if (likes.length === LIKES_PER_PAGE) {
            currentLikesPage++;
            container.insertAdjacentHTML('beforeend', `
                <button id="load-more-likes-btn" onclick="window.openLikesModal(null, true)" class="w-full py-3 mt-2 mb-4 text-sm font-bold text-primary bg-primary/10 rounded-xl active:scale-95 transition-transform flex justify-center items-center">
                    Load More
                </button>
            `);
        }

    } catch (err) {
        console.error("Likes fetch error:", err);
        if (!isLoadMore && container) container.innerHTML = `<div class="py-10 text-center text-error text-sm font-bold">Failed to load likes.</div>`;
        else {
            const oldBtn = document.getElementById('load-more-likes-btn');
            if(oldBtn) oldBtn.innerHTML = "Error loading. Tap to retry.";
        }
    }
};
window.closeLikesModal = function() {
    const modal = document.getElementById('modal-likes-list');
    const card = document.getElementById('likes-modal-card');
    
    if (modal && card) {
        modal.style.pointerEvents = 'none';
        modal.classList.add('opacity-0');
        card.style.transform = ''; 
        card.classList.add('translate-y-full');
        
        setTimeout(() => { 
            modal.classList.replace('flex', 'hidden'); 
            modal.style.pointerEvents = 'auto'; 
        }, 300); 
    }
};

window.openEventRsvps = async (postId) => {
    const modal = document.getElementById('modal-event-rsvps');
    const list = document.getElementById('event-rsvps-list');
    if (!modal || !list) return;

    modal.classList.replace('hidden', 'flex');
    list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">Loading RSVPs...</p>`;

    try {
        const { data, error } = await supabase
            .from('post_event_rsvps')
            .select('users(id, full_name, profile_img_url, tick_type)')
            .eq('post_id', postId)
            .eq('status', 'attending');

        if (error) throw error;
        if (data.length === 0) {
            list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">No one has RSVP'd yet.</p>`;
            return;
        }

        list.innerHTML = data.map(v => `
            <div class="flex items-center gap-3 p-3 bg-surface-variant/10 dark:bg-neutral-800 rounded-2xl border border-surface-variant/30 dark:border-neutral-700">
                <img onclick="window.viewUserProfile('${v.users.id}')" src="${v.users.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(v.users.full_name)}`}" class="w-10 h-10 rounded-full object-cover cursor-pointer">
                <p onclick="window.viewUserProfile('${v.users.id}')" class="font-bold text-sm text-on-surface dark:text-gray-100 flex items-center gap-1 cursor-pointer hover:text-primary transition-colors">${v.users.full_name} ${window.getTickHtml ? window.getTickHtml(v.users.tick_type) : ''}</p>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = `<p class="text-sm italic text-center py-8 text-error">Failed to load RSVPs. The list might be hidden by the author.</p>`;
        console.error("RSVP load error:", e);
    }
};

window.isRsvping = false;

window.handleRSVP = async function(postId, isCurrentlyAttending) {
    if (!window.checkVerification('RSVP to events')) return; 
    if (window.isRsvping) return;
    window.isRsvping = true;
    
    const postEl = document.querySelector(`div[data-post-id="${postId}"]`);
    if (postEl) postEl.style.opacity = '0.6';

    try {
        if (!navigator.onLine) {
            // 🚀 OFFLINE QUEUE
            await queueOfflineAction('rsvp_event', { postId, userId: currentUser.id, isCurrentlyAttending });
            showToast(isCurrentlyAttending ? 'RSVP Cancelled (Saved Offline)' : 'RSVP Confirmed (Saved Offline)', 'info');
            
            // Optimistic UI update for offline mode
            const btn = postEl.querySelector('button[onclick^="window.handleRSVP"]');
            if (btn) {
                const nowAttending = !isCurrentlyAttending;
                btn.className = `block w-full mt-3 ${nowAttending ? 'bg-surface-variant/50 text-on-surface dark:text-gray-100' : 'bg-primary text-white'} text-center py-2 rounded-xl text-[13px] font-bold active:scale-95 transition-all`;
                btn.textContent = nowAttending ? '✓ Attending' : 'RSVP Now';
                btn.setAttribute('onclick', `window.handleRSVP('${postId}', ${nowAttending})`);
            }
        } else {
            // NORMAL ONLINE SYNC
            if (isCurrentlyAttending) {
                const { error } = await supabase.from('post_event_rsvps').delete().match({ post_id: postId, user_id: currentUser.id });
                if (error) throw error;
                showToast('RSVP Cancelled', 'info');
            } else {
                const { error } = await supabase.from('post_event_rsvps').insert({ post_id: postId, user_id: currentUser.id, status: 'attending' });
                if (error) throw error;
                showToast('RSVP Confirmed!', 'success');
            }
            if (typeof window.refreshMainFeed === 'function') await window.refreshMainFeed(); 
        }

    } catch (error) {
        console.error('RSVP Error:', error);
        showToast(error.message || 'Failed to update RSVP status', 'error');
    } finally {
        if (postEl) postEl.style.opacity = '1';
        window.isRsvping = false;
    }
};

window.searchAndOpenProfile = async function(fullName) {
    const cleanName = fullName.replace(/\u00A0/g, ' ').trim();
    try {
        const { data, error } = await supabase.from('users').select('id').eq('full_name', cleanName).limit(1).maybeSingle();
        if (data && data.id) {
            window.closeCommentsModal();
            setTimeout(() => window.viewUserProfile(data.id), 200);
        } else {
            showToast('User not found', 'error');
        }
    } catch(e) { console.error(e); }
};

window._saveLocks = window._saveLocks || {};

window.handleSavePost = async function(postId, btnElement) {
    const activeUser = currentUser || (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null);
    if (!activeUser || window._saveLocks[postId]) return;
    window._saveLocks[postId] = true;

    const isSaved = btnElement.classList.contains('text-primary');
    const nextSavedState = !isSaved;

    document.querySelectorAll(`.save-btn[data-post-id="${postId}"]`).forEach(btn => {
        btn.dataset.saved = nextSavedState.toString();
        const iconSpan = btn.querySelector('.material-symbols-outlined');
        
        if (nextSavedState) {
            btn.classList.remove('text-on-surface', 'dark:text-gray-100', 'hover:text-on-surface-variant');
            btn.classList.add('text-primary');
            if (iconSpan) {
                iconSpan.style.fontVariationSettings = "'FILL' 1";
                iconSpan.classList.remove('animate-[pulse_0.3s_ease-out]');
                void iconSpan.offsetWidth;
                iconSpan.classList.add('animate-[pulse_0.3s_ease-out]');
            }
        } else {
            btn.classList.remove('text-primary');
            btn.classList.add('text-on-surface', 'dark:text-gray-100', 'hover:text-on-surface-variant');
            if (iconSpan) {
                iconSpan.style.fontVariationSettings = "'FILL' 0";
                iconSpan.classList.remove('animate-[pulse_0.3s_ease-out]');
            }
        }
    });

    const savedPanel = document.getElementById('panel-saved-posts');
    if (!nextSavedState && savedPanel && !savedPanel.classList.contains('translate-x-full')) {
        const postCard = btnElement.closest(`div[data-post-id="${postId}"]`);
        if (postCard) {
            postCard.style.transition = 'all 0.3s ease';
            postCard.style.transform = 'scale(0.9)';
            postCard.style.opacity = '0';
            setTimeout(() => postCard.remove(), 300);
        }
    }

    try {
        if (!navigator.onLine) {
            // 🚀 OFFLINE QUEUE
            await queueOfflineAction('save_post', { postId, userId: activeUser.id, isSaved });
        } else {
            // NORMAL ONLINE SYNC
            if (!nextSavedState) {
                await supabase.from('saved_posts').delete().match({ post_id: postId, user_id: activeUser.id });
            } else {
                await supabase.from('saved_posts').insert({ post_id: postId, user_id: activeUser.id });
            }
        }
    } catch(e) { console.error("Save error:", e); }
    finally { setTimeout(() => { window._saveLocks[postId] = false; }, 300); }
};

window.openPostOptions = function(postId, postOwnerId, isVerified, hideLikes, disableComments, isArchived, postType, isPollActive, anchorEl) {
    const isOwner = currentUser.id === postOwnerId;
    let buttonsHtml = '';

    if (isOwner) {
        if (postType === 'poll' && isPollActive) {
            buttonsHtml += popupMenuItem('stop_circle', 'End Poll Now', `window.endPollEarly('${postId}')`, true);
        }
        buttonsHtml += isArchived
            ? popupMenuItem('unarchive', 'Unarchive Post', `window.unarchivePost('${postId}')`)
            : popupMenuItem('archive', 'Archive Post', `window.archivePost('${postId}')`);
        buttonsHtml += popupMenuItem(hideLikes ? 'visibility' : 'visibility_off', hideLikes ? 'Unhide like count' : 'Hide like count', `window.togglePostSetting('${postId}', 'hide_likes', ${!hideLikes})`);
        buttonsHtml += popupMenuItem(disableComments ? 'chat_bubble' : 'comments_disabled', disableComments ? 'Turn on commenting' : 'Turn off commenting', `window.togglePostSetting('${postId}', 'disable_comments', ${!disableComments})`);
        buttonsHtml += popupMenuItem('delete', 'Delete Post', `window.deletePost('${postId}')`, true);
    } else {
        if (isVerified) {
            buttonsHtml = `<p class="text-[13px] text-center text-on-surface-variant font-medium px-4 py-3">Official Verified Posts cannot be reported.</p>`;
        } else {
            buttonsHtml = popupMenuItem('flag', 'Report Post', `window.openReportPostModal('${postId}')`, true);
        }
    }
    window.openPopupMenu(anchorEl, buttonsHtml);
};

window.endPollEarly = async function(postId) {
    window.closePopupMenu();
    const { error } = await supabase.from('post_polls').update({ is_ended_early: true }).eq('post_id', postId);
    if (error) {
        showToast('Failed to end poll.', 'error');
    } else {
        showToast('Poll ended successfully.', 'success');
        if (typeof window.updatePollUI === 'function') window.updatePollUI(postId);
    }
};

window.togglePostSetting = async function(postId, column, value) {
    window.closePopupMenu();
    const updatePayload = {};
    updatePayload[column] = value;
    
    const { error } = await supabase.from('posts').update(updatePayload).eq('id', postId);
    if (error) {
        showToast('Failed to update setting.', 'error');
    } else {
        showToast('Setting updated.', 'success');
        if (typeof window.refreshMainFeed === 'function') window.refreshMainFeed();
    }
};

window.archivePost = async function(postId) {
    window.closePopupMenu();
    
    document.querySelectorAll(`div[data-post-id="${postId}"]`).forEach(el => {
        el.style.transition = 'all 0.3s ease';
        el.style.transform = 'scale(0.9)';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    });

    const { error } = await supabase.from('posts').update({ is_archived: true }).eq('id', postId);
    if (error) showToast('Failed to archive.', 'error');
    else showToast('Post archived.', 'success');
};

window.unarchivePost = async function(postId) {
    window.closePopupMenu();
    
    const archivedPanel = document.getElementById('panel-archived-posts');
    if (archivedPanel && !archivedPanel.classList.contains('translate-x-full')) {
        document.querySelectorAll(`div[data-post-id="${postId}"]`).forEach(el => {
            el.style.transition = 'all 0.3s ease';
            el.style.transform = 'scale(0.9)';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        });
    }

    const { error } = await supabase.from('posts').update({ is_archived: false }).eq('id', postId);
    if (error) showToast('Failed to unarchive.', 'error');
    else {
        showToast('Post restored to profile.', 'success');
        if (typeof window.refreshMyProfile === 'function') window.refreshMyProfile();
    }
};

window.togglePollDeadlineInputs = function() {
    const typeEl = document.getElementById('poll-deadline-type');
    const type = typeEl ? typeEl.value : 'post_expiry';
    const timeInput = document.getElementById('poll-deadline-time');
    const countInput = document.getElementById('poll-deadline-count');
    if (timeInput) timeInput.classList.toggle('hidden', type !== 'time');
    if (countInput) countInput.classList.toggle('hidden', type !== 'voter_count');
};

window.openPollAccessSelector = function() {
    const buttons = `
        <div class="px-4 py-3 border-b border-surface-variant/40 dark:border-neutral-800 text-center">
            <p class="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Who can vote?</p>
        </div>
        <button onclick="setPollAccess('all', 'Everyone')" class="w-full text-left px-5 py-4 border-b border-surface-variant/40 font-bold text-[15px] hover:bg-surface-variant/30 transition-colors">Everyone</button>
        <button onclick="setPollAccess('connections', 'Only My Connections')" class="w-full text-left px-5 py-4 border-b border-surface-variant/40 font-bold text-[15px] hover:bg-surface-variant/30 transition-colors">Only My Connections</button>
        <button onclick="setPollAccess('custom', 'My Custom List')" class="w-full text-left px-5 py-4 font-bold text-[15px] hover:bg-surface-variant/30 transition-colors text-primary flex justify-between">My Custom List <span class="material-symbols-outlined text-[18px]">lock</span></button>
    `;
    window.openActionSheet(buttons);
};

window.setPollAccess = function(val, label) {
    const accessEl = document.getElementById('poll-voters-access');
    const labelEl = document.getElementById('poll-voters-access-label');
    const shortcut = document.getElementById('manage-custom-list-shortcut');
    if (accessEl) accessEl.value = val;
    if (labelEl) labelEl.textContent = label;
    if (shortcut) shortcut.classList.toggle('hidden', val !== 'custom');
    window.closeActionSheet();
};

window.openPollDeadlineSelector = function() {
    const buttons = `
        <div class="px-4 py-3 border-b border-surface-variant/40 dark:border-neutral-800 text-center">
            <p class="text-xs font-bold text-on-surface-variant uppercase tracking-wider">End Poll Automatically</p>
        </div>
        <button onclick="setPollDeadline('post_expiry', 'When the post expires')" class="w-full text-left px-5 py-4 border-b border-surface-variant/40 font-bold text-[15px] hover:bg-surface-variant/30 transition-colors">When the post expires</button>
        <button onclick="setPollDeadline('time', 'At a specific date & time')" class="w-full text-left px-5 py-4 border-b border-surface-variant/40 font-bold text-[15px] hover:bg-surface-variant/30 transition-colors">At a specific date & time</button>
        <button onclick="setPollDeadline('voter_count', 'After a set number of votes')" class="w-full text-left px-5 py-4 font-bold text-[15px] hover:bg-surface-variant/30 transition-colors">After a set number of votes</button>
    `;
    window.openActionSheet(buttons);
};

window.setPollDeadline = function(val, label) {
    const deadlineEl = document.getElementById('poll-deadline-type');
    const labelEl = document.getElementById('poll-deadline-type-label');
    if (deadlineEl) deadlineEl.value = val;
    if (labelEl) labelEl.textContent = label;
    window.togglePollDeadlineInputs();
    window.closeActionSheet();
};
// ==========================================
// 🚀 SUPABASE REALTIME ENGINE
// ==========================================
function setupRealtimeFeed() {
    // 🚀 NEW: Disable realtime WebSockets if offline
    if (!currentUser || !navigator.onLine) return;

    // Listen for new rows inserted into the 'posts' table
    supabase
        .channel('public-posts-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, payload => {
            // Ignore the event if the new post was created by the currently logged-in user
            if (payload.new.user_id === currentUser.id) return;

            const container = document.getElementById('feed-posts-container');
            if (!container) return;

            // Don't spawn multiple pills if multiple posts come in quickly
            if (document.getElementById('new-posts-pill')) return;

            // Create a sticky floating pill button
            const pillHtml = `
                <div id="new-posts-pill" class="flex justify-center w-full sticky top-2 z-[60] animate-fadeIn mb-4">
                    <button onclick="window.scrollTo({ top: 0, behavior: 'smooth' }); window.refreshMainFeed(); this.parentElement.remove();" 
                            class="bg-primary text-white px-5 py-2 rounded-full text-sm font-bold shadow-lg flex items-center gap-2 active:scale-95 transition-transform border-2 border-surface dark:border-[#1e1e1e]">
                        <span class="material-symbols-outlined text-[18px]">arrow_upward</span>
                        New posts
                    </button>
                </div>
            `;
            
            // Inject it at the very top of the feed container
            container.insertAdjacentHTML('afterbegin', pillHtml);
        })
        .subscribe();
}
