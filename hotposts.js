import { supabase } from './supabase.js';
import { showToast } from './ui.js';
import { timeAgo, saveHotpostsToCache, getHotpostsFromCache } from './utils.js';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_HOTPOSTS_PRESET } from './config.js';
import { getHotposts, invalidateHotpostsCache, getBlockedUserIds, getAcceptedConnections } from './data-layer.js';

// ==========================================
// STATE MANAGEMENT & FONT ENGINE
// ==========================================
let hotpostsByUser = new Map();
let currentUser = null;
let sessionViewedPostIds = new Set();
let isUploadingBackground = false; 
let myConnectionIds = new Set(); // who I can reply to (connections-only, like DMs)

const HOTPOST_SKELETON = `
    <div class="flex flex-col items-center gap-1.5 shrink-0">
        <div class="w-[80px] h-[80px] rounded-full shimmer-bg shadow-sm"></div>
        <div class="w-12 h-2.5 rounded-full shimmer-bg mt-1"></div>
    </div>
`.repeat(6);

const ACTIVITY_SKELETON = `
    <div class="flex items-center gap-3 p-3 animate-pulse">
        <div class="w-10 h-10 rounded-full shimmer-bg shrink-0"></div>
        <div class="flex-1 space-y-2">
            <div class="h-3.5 shimmer-bg rounded-md w-1/2"></div>
            <div class="h-2.5 shimmer-bg rounded-md w-1/3"></div>
        </div>
    </div>
`.repeat(5);

// 🚀 NATIVE ZERO-LOAD FONT STACKS (Matches Instagram Styles)
const TEXT_FONTS = [
    { name: 'Classic', value: 'Georgia, serif' },
    { name: 'Modern', value: 'system-ui, -apple-system, sans-serif' },
    { name: 'Neon', value: '"Arial Rounded MT Bold", Arial, sans-serif' },
    { name: 'Typewriter', value: '"Courier New", Courier, monospace' },
    { name: 'Strong', value: 'Impact, Charcoal, sans-serif' },
    { name: 'Elegant', value: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
    { name: 'Headline', value: '"Arial Black", Gadget, sans-serif' },
    { name: 'Simple', value: 'Arial, Helvetica, sans-serif' },
    { name: 'Editor', value: '"Lucida Console", Monaco, monospace' },
    { name: 'Fancy', value: '"Brush Script MT", "Lucida Handwriting", cursive' },
    { name: 'Comic', value: '"Comic Sans MS", "Comic Sans", cursive' },
    { name: 'Memo', value: '"Trebuchet MS", "Lucida Grande", sans-serif' }
];

const TEXT_COLORS = ['#FFFFFF', '#000000', '#FF3B30', '#34C759', '#007AFF', '#FFD60A', '#FF9F0A', '#BF5AF2', '#32ADE6'];

let currentTextFont = TEXT_FONTS[0].value;
let currentTextColor = '#FFFFFF';
let currentTextBg = false;
let currentTextAlign = 'center'; // 🚀 Added Alignment State

// 🚀 Calculates perfect contrast (Black or White) for Text Backgrounds
function getContrastYIQ(hexcolor){
    hexcolor = hexcolor.replace("#", "");
    if (hexcolor.length === 3) hexcolor = hexcolor.split('').map(c => c+c).join('');
    var r = parseInt(hexcolor.substr(0,2),16);
    var g = parseInt(hexcolor.substr(2,2),16);
    var b = parseInt(hexcolor.substr(4,2),16);
    var yiq = ((r*299)+(g*587)+(b*114))/1000;
    return (yiq >= 128) ? '#000000' : '#FFFFFF';
}

let currentCameraStream = null;
let currentFacingMode = 'environment';
let currentPhotoBlob = null;
let baseImageObj = null; 
let currentPreviewObjectURL = null; // 🚀 FIX: Added to track memory leaks
// 🚀 NEW: Video Recording Engine States
let currentMediaType = 'image';
let mediaRecorder = null;
let recordedChunks = [];
let recordingTimer = null;
let isRecording = false;

let videoZoomScale = 1;
let initialVideoPinchDist = 0;

let imgTransform = { scale: 1, x: 0, y: 0 }; 
let isDraggingBg = false;
let bgDragStartX = 0, bgDragStartY = 0;
let initialBgScale = 1;

const FILTER_LIST = [
    { name: 'NORMAL', css: 'none' },
    { name: 'VIVID', css: 'saturate(1.6) contrast(1.1)' },
    { name: 'WARM', css: 'sepia(0.4) saturate(1.2) contrast(1.1)' },
    { name: 'COOL', css: 'hue-rotate(180deg) saturate(1.2)' },
    { name: 'B&W', css: 'grayscale(1) contrast(1.2)' }
];
let currentFilterIndex = 0;

let textElements = [];
let activeTextId = null;
let activeTextIdForTouch = null;
let textTouchStartTime = 0;
let initialPinchDist = 0;
let initialTextScale = 1.0;
let textInitialObjX = 0, textInitialObjY = 0;

let isDrawMode = false;
let isDrawing = false;
let currentDoodleColor = '#FFFFFF'; 
let currentDoodleWidth = 6; 
let doodlePaths = []; 
let currentPath = [];

let currentViewerState = {
    userId: null, userOrder: [], userIndex: -1, postIndex: 0,
    storyTimer: null, storyDuration: 5000, animationStartTime: 0, remainingDuration: 0,
};

const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

export function initHotposts(user) {
    currentUser = user;
    setupEventListeners();
    fetchHotposts();
}

function setupEventListeners() {
    document.getElementById('close-hotpost-camera-btn')?.addEventListener('click', attemptCloseCamera);
    document.getElementById('switch-hotpost-camera-btn')?.addEventListener('click', switchCamera);
    document.getElementById('submit-hotpost-btn')?.addEventListener('click', submitHotpost);

    document.getElementById('add-text-hotpost-btn')?.addEventListener('click', () => {
        document.querySelectorAll('.text-widget').forEach(el => el.classList.remove('active'));
        activeTextId = null;
        activeTextIdForTouch = null;
        activateTextTool(null);
    });
    
    document.getElementById('doodle-hotpost-btn')?.addEventListener('click', toggleDrawMode);
    document.getElementById('undo-doodle-btn')?.addEventListener('click', undoLastDoodle);
    
    document.querySelectorAll('.doodle-color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => setDoodleColor(e.target.dataset.color));
    });

    document.getElementById('cancel-text-btn')?.addEventListener('click', () => {
        document.getElementById('hotpost-text-editor-overlay').classList.replace('flex', 'hidden');
    });
    document.getElementById('done-text-btn')?.addEventListener('click', saveTextFromUI);
    
    document.getElementById('toggle-text-bg-btn')?.addEventListener('click', () => {
        currentTextBg = !currentTextBg;
        updateTextUIPreview();
    });

    document.getElementById('toggle-text-align-btn')?.addEventListener('click', (e) => {
        const btn = e.currentTarget.querySelector('span');
        if (currentTextAlign === 'center') {
            currentTextAlign = 'left';
            btn.textContent = 'format_align_left';
        } else if (currentTextAlign === 'left') {
            currentTextAlign = 'right';
            btn.textContent = 'format_align_right';
        } else {
            currentTextAlign = 'center';
            btn.textContent = 'format_align_center';
        }
        updateTextUIPreview();
    });

    const colorPicker = document.getElementById('text-color-picker');
    if (colorPicker) {
        colorPicker.innerHTML = TEXT_COLORS.map(color => `
            <button class="w-8 h-8 rounded-full shrink-0 border-2 ${color === '#FFFFFF' ? 'border-gray-300' : 'border-transparent'} shadow-sm transition-transform active:scale-90 text-color-btn" data-color="${color}" style="background-color: ${color};"></button>
        `).join('');
        colorPicker.querySelectorAll('.text-color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                currentTextColor = e.currentTarget.dataset.color; 
                updateTextUIPreview();
            });
        });
    }

    const fontPicker = document.getElementById('text-font-picker');
    if (fontPicker) {
        fontPicker.innerHTML = TEXT_FONTS.map((font, index) => `
            <button class="px-4 py-1.5 rounded-full shrink-0 bg-white/20 text-white font-bold text-sm transition-transform active:scale-90 text-font-btn" data-fontindex="${index}" style="font-family: ${font.value.replace(/"/g, "'")}">${font.name}</button>
        `).join('');
        fontPicker.querySelectorAll('.text-font-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.currentTarget.dataset.fontindex; 
                currentTextFont = TEXT_FONTS[idx].value;
                updateTextUIPreview();
            });
        });
    }
    
    setupVideoZoomPhysics();
    setupEditorTouchPhysics();
    setupViewerTouchPhysics();

    document.getElementById('close-hotpost-viewer-btn')?.addEventListener('click', closeHotpostViewer);
    document.getElementById('hotpost-reply-btn')?.addEventListener('click', handleReplyToHotpost);
    document.getElementById('hotpost-like-btn')?.addEventListener('click', handleLikeHotpost);

    const navNext = document.getElementById('hotpost-nav-next');
    const navPrev = document.getElementById('hotpost-nav-prev');
    const replyInput = document.getElementById('hotpost-reply-input');
    
    let storyTouchTimer = null;
    let isStoryHolding = false;
    let lastTapTime = 0;

    const handleStoryPointerDown = (e) => {
        pauseStory();
        isStoryHolding = false;

        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTapTime;
        
        if (tapLength < 300 && tapLength > 0) {
            clearTimeout(storyTouchTimer);
            const likeBtn = document.getElementById('hotpost-like-btn');
            if (likeBtn && currentViewerState.userId !== currentUser.id) {
                handleLikeHotpost({ stopPropagation: () => {}, currentTarget: likeBtn });
                window.showDoubleTapHeart(e.clientX, e.clientY);
            }
            lastTapTime = 0; 
            return;
        }
        lastTapTime = currentTime;

        storyTouchTimer = setTimeout(() => {
            isStoryHolding = true;
            window.toggleViewerUI(false); 
        }, 200);
    };

    const handleStoryPointerUp = (e) => {
        clearTimeout(storyTouchTimer);
        resumeStory();
        
        if (isStoryHolding) {
            window.toggleViewerUI(true); 
        } else {
            if (e.target.id === 'hotpost-nav-next') nextStory();
            if (e.target.id === 'hotpost-nav-prev') prevStory();
        }
        isStoryHolding = false;
    };

    [navNext, navPrev].forEach(el => {
        if (el) {
            el.addEventListener('pointerdown', handleStoryPointerDown);
            el.addEventListener('pointerup', handleStoryPointerUp);
            el.addEventListener('pointerleave', () => {
                clearTimeout(storyTouchTimer);
                if (isStoryHolding) window.toggleViewerUI(true);
                resumeStory();
                isStoryHolding = false;
            });
        }
    });
    
    replyInput?.addEventListener('focus', pauseStory);
    replyInput?.addEventListener('blur', resumeStory);

    document.getElementById('details-tab-viewers')?.addEventListener('click', () => switchDetailsTab('viewers'));
    document.getElementById('details-tab-likes')?.addEventListener('click', () => switchDetailsTab('likes'));
    document.getElementById('hotpost-activity-btn')?.addEventListener('click', openActivityPanel);
    document.getElementById('activity-backdrop-close')?.addEventListener('click', closeActivityPanel);
    
    document.getElementById('delete-hotpost-action-btn')?.addEventListener('click', () => {
        showCustomConfirm("Delete Hotpost?", "This will permanently remove this post from your story.", executeDeleteHotpost);
    });

    // ---------------------------------------------------------
    // 🚀 NEW LOGIC FROM STEP 2A: MUTE BUTTON AND CAPTURE PHYSICS
    // ---------------------------------------------------------

    // 🚀 NEW: Mute/Unmute Video Preview
    document.getElementById('hotpost-mute-btn')?.addEventListener('click', (e) => {
        const vidEl = document.getElementById('hotpost-preview-video');
        const icon = e.currentTarget.querySelector('span');
        vidEl.muted = !vidEl.muted;
        icon.textContent = vidEl.muted ? 'volume_off' : 'volume_up';
    });

// 🚀 Absolute Bulletproof Touch/Mouse Hybrid Physics
    const captureBtn = document.getElementById('capture-hotpost-btn');
    let pressTimer = null;
    let isPressing = false;
    let isRecordingVideo = false;
    let startCaptureY = 0;
    let initialCaptureZoom = 1;

    const startPress = (e) => {
        if (e.type === 'touchstart' && e.cancelable) e.preventDefault(); 
        if (isPressing) return;
        isPressing = true;
        isRecordingVideo = false;

        // 🚀 NEW: Premium haptic "click" when touching the button
        if (navigator.vibrate) navigator.vibrate(50); 

        if (e.touches) {
            startCaptureY = e.touches[0].clientY;
            initialCaptureZoom = videoZoomScale;
        }

        pressTimer = setTimeout(() => { 
            if (isPressing) {
                isRecordingVideo = true;
                // 🚀 NEW: Double haptic tick to confirm video started
                if (navigator.vibrate) navigator.vibrate([50, 50, 50]); 
                startRecording(); 
            }
        }, 300); 
    };
    
    const movePress = (e) => {
        if (!isPressing) return;
        if (e.cancelable) e.preventDefault();
        
        if (e.touches) {
            const currentY = e.touches[0].clientY;
            const deltaY = startCaptureY - currentY; 
            updateCameraZoom(initialCaptureZoom + (deltaY * 0.015));
        }
    };

    const endPress = (e) => {
        if (e.type === 'touchend' || e.type === 'touchcancel') {
            if (e.cancelable) e.preventDefault();
        }
        
        if (!isPressing) return;
        isPressing = false;
        clearTimeout(pressTimer);
        
        if (isRecordingVideo) {
            stopRecording(); 
            if (navigator.vibrate) navigator.vibrate(50); // Haptic stop
        } else {
            capturePhoto(); 
        }
        isRecordingVideo = false;
    };

    if (captureBtn) {
        captureBtn.addEventListener('touchstart', startPress, { passive: false });
        captureBtn.addEventListener('touchmove', movePress, { passive: false }); 
        captureBtn.addEventListener('touchend', endPress, { passive: false });
        captureBtn.addEventListener('touchcancel', endPress, { passive: false });
        
        captureBtn.addEventListener('mousedown', startPress);
        captureBtn.addEventListener('mouseup', endPress);
        captureBtn.addEventListener('mouseleave', endPress);
    }
    // ---------------------------------------------------------

    // 🚀 NEW: Bulletproof Gallery Input (Memory Safe, Handles Images & Videos)
    document.getElementById('hotpost-gallery-input')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Clean up old memory before processing the new file
        if (currentPreviewObjectURL) {
            URL.revokeObjectURL(currentPreviewObjectURL);
            currentPreviewObjectURL = null;
        }

        if (file.type.startsWith('video/')) {
            if (file.size > 30 * 1024 * 1024) return showToast('Video is too large (max 30MB)', 'error');
            
            currentMediaType = 'video';
            currentPhotoBlob = file;
            currentPreviewObjectURL = URL.createObjectURL(file);
            
            const videoEl = document.getElementById('hotpost-preview-video');
            videoEl.src = currentPreviewObjectURL;
            
            // 🚀 FIX: Use onloadeddata for strict mobile compatibility instead of metadata
            videoEl.onloadeddata = () => {
                videoEl.play().catch(err => console.error("Gallery playback blocked:", err));
                showPreviewUI();
                initDoodleCanvas();
            };
        } else {
            currentMediaType = 'image';
            const reader = new FileReader();
            reader.onload = (event) => {
                currentPhotoBlob = file;
                baseImageObj = new Image();
                baseImageObj.onload = () => {
                    document.getElementById('hotpost-preview-img').src = event.target.result;
                    imgTransform = { scale: 1, x: 0, y: 0 }; 
                    document.getElementById('hotpost-preview-img').style.transform = `translate(0px, 0px) scale(1)`;
                    showPreviewUI();
                    initDoodleCanvas();
                };
                baseImageObj.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
        
        e.target.value = '';
    });

    // 🚀 NEW: Hardware Volume Button Shutter (Pro Feature)
    window.addEventListener('keydown', (e) => {
        const cameraModal = document.getElementById('modal-hotpost-camera');
        const previewUI = document.getElementById('preview-ui');
        
        // Only trigger if Camera is open AND we are NOT in the review screen
        if (!cameraModal.classList.contains('hidden') && previewUI.classList.contains('hidden')) {
            if (e.key === 'VolumeUp' || e.key === 'VolumeDown') {
                e.preventDefault(); // Stop the phone volume slider from showing up
                if (!isRecordingVideo) {
                    if (navigator.vibrate) navigator.vibrate(50);
                    capturePhoto();
                }
            }
        }
    });
}

function showCustomConfirm(title, message, onConfirm) {
    pauseStory();
    const modal = document.getElementById('modal-confirm-action');
    if(!modal) return;
    
    document.getElementById('confirm-action-title').textContent = title;
    document.getElementById('confirm-action-message').textContent = message;
    
    modal.classList.replace('hidden', 'flex');
    
    const confirmBtn = document.getElementById('confirm-action-yes');
    const cancelBtn = document.getElementById('confirm-action-no');
    
    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    
    newCancelBtn.addEventListener('click', () => {
        modal.classList.replace('flex', 'hidden');
        resumeStory();
    });
    
    newConfirmBtn.addEventListener('click', () => {
        modal.classList.replace('flex', 'hidden');
        onConfirm();
    });
}

function attemptCloseCamera() {
    if (currentPhotoBlob) {
        showCustomConfirm("Discard Hotpost?", "If you go back now, you will lose your edits.", () => {
            resetCameraUI();
            closeCameraModal(true); 
        });
    } else {
        closeCameraModal(true);
    }
}

// ==========================================
// CAMERA ENGINE
// ==========================================
async function openCameraModal() {
    if (!window.checkVerification('post a story')) return; // 🚀 Soft Restrict Check

    const modal = document.getElementById('modal-hotpost-camera');
    const video = document.getElementById('hotpost-camera-feed');
    modal.classList.replace('hidden', 'flex');
    resetCameraUI();
    toggleCameraStatusBar(true);

    if (currentCameraStream) currentCameraStream.getTracks().forEach(track => track.stop());

    try {
        // 🚀 FIX: Reduced resolution to 720p. 1080p causes severe real-time encoding lag on mobile devices!
        currentCameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true 
        });
        video.srcObject = currentCameraStream;
        video.muted = true; 
        
        videoZoomScale = 1;
        video.style.transform = currentFacingMode === 'user' ? `scaleX(-1) scale(${videoZoomScale})` : `scale(${videoZoomScale})`;
    } catch (err) {
        showToast('Camera or Microphone access denied.', 'error');
        closeCameraModal(true);
    }
}

function closeCameraModal(force = false) {
    const modal = document.getElementById('modal-hotpost-camera');
    
    // IMPROVED: Cleanup camera stream properly
    if (currentCameraStream) {
        try {
            currentCameraStream.getTracks().forEach(track => {
                track.stop();
            });
            currentCameraStream = null;
        } catch (e) {
            console.error("Error stopping camera stream:", e);
        }
    }

    // IMPROVED: Cleanup video recording
    if (mediaRecorder && isRecording) {
        try {
            mediaRecorder.stop();
            isRecording = false;
        } catch (e) {
            console.error("Error stopping recording:", e);
        }
    }

    if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
    }

    // IMPROVED: Cleanup preview URL
    if (currentPhotoBlob) {
        try {
            if (currentPreviewObjectURL) {
                URL.revokeObjectURL(currentPreviewObjectURL);
                currentPreviewObjectURL = null;
            }
            currentPhotoBlob = null;
        } catch (e) {
            console.error("Error revoking object URL:", e);
        }
    }

    modal.classList.replace('flex', 'hidden');
    toggleCameraStatusBar(false);
}

function switchCamera() {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    openCameraModal();
}

function setupVideoZoomPhysics() {
    const video = document.getElementById('hotpost-camera-feed');
    let initialY = 0;
    let initialZoom = 1;
    let lastTapTime = 0; // 🚀 For tracking double-taps

    const getPinchDistance = (touches) => {
        return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    };

    video.addEventListener('touchstart', (e) => {
        if (document.getElementById('preview-ui').classList.contains('hidden')) {
            if (e.touches.length === 2) {
                initialVideoPinchDist = getPinchDistance(e.touches);
            } else if (e.touches.length === 1) {
                initialY = e.touches[0].clientY;
                initialZoom = videoZoomScale;
            }
        }
    }, { passive: true });

    video.addEventListener('touchmove', (e) => {
        if (document.getElementById('preview-ui').classList.contains('hidden')) {
            if (e.cancelable) e.preventDefault();

            if (e.touches.length === 2) {
                const currentDist = getPinchDistance(e.touches);
                const scaleChange = currentDist / initialVideoPinchDist;
                updateCameraZoom(videoZoomScale * scaleChange);
                initialVideoPinchDist = currentDist;
            } else if (e.touches.length === 1) {
                const currentY = e.touches[0].clientY;
                const deltaY = initialY - currentY; 
                updateCameraZoom(initialZoom + (deltaY * 0.015));
            }
        }
    }, { passive: false });

    // 🚀 NEW: Double-Tap to Flip Camera Muscle Memory
    video.addEventListener('touchend', (e) => {
        if (document.getElementById('preview-ui').classList.contains('hidden')) {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTapTime;
            
            // If tapped twice within 300ms
            if (tapLength < 300 && tapLength > 0 && e.changedTouches.length === 1) {
                switchCamera();
                if (navigator.vibrate) navigator.vibrate(50); // Haptic tick
            }
            lastTapTime = currentTime;
        }
    }, { passive: true });
}

let isHardwareZoomActive = false;

function updateCameraZoom(newScale) {
    videoZoomScale = Math.max(1.0, Math.min(4.0, newScale));
    const video = document.getElementById('hotpost-camera-feed');
    
    if (currentCameraStream) {
        const track = currentCameraStream.getVideoTracks()[0];
        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        
        if (capabilities.zoom) {
            isHardwareZoomActive = true;
            const min = capabilities.zoom.min || 1;
            const max = capabilities.zoom.max || 4;
            const targetZoom = min + ((videoZoomScale - 1) / 3) * (max - min);
            
            track.applyConstraints({ advanced: [{ zoom: targetZoom }] }).catch(e => console.warn(e));
            
            // Clear software zoom so it doesn't double-zoom
            if(video) video.style.transform = currentFacingMode === 'user' ? `scaleX(-1)` : `scale(1)`;
            return;
        }
    }
    
    // Fallback: Pure software CSS zoom
    isHardwareZoomActive = false;
    if(video) {
        video.style.transform = currentFacingMode === 'user' 
            ? `scaleX(-1) scale(${videoZoomScale})` 
            : `scale(${videoZoomScale})`;
    }
}

function capturePhoto() {
    if (!currentCameraStream) return;

    const video = document.getElementById('hotpost-camera-feed');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    if (currentFacingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }

    // Capture raw frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
        currentPhotoBlob = blob;
        currentMediaType = 'image';
        baseImageObj = new Image();
        baseImageObj.onload = () => {
            const previewImg = document.getElementById('hotpost-preview-img');
            previewImg.src = URL.createObjectURL(blob);
            
            // 🚀 Carry over software zoom. If hardware zoom worked, image is ALREADY zoomed (scale 1).
            const reviewScale = isHardwareZoomActive ? 1 : videoZoomScale;
            imgTransform = { scale: reviewScale, x: 0, y: 0 };
            previewImg.style.transform = `translate(0px, 0px) scale(${reviewScale})`;
            
            showPreviewUI();
            initDoodleCanvas();
        };
        baseImageObj.src = URL.createObjectURL(blob);
    }, 'image/webp', 0.9);
}
let animationFrameId = null;
function startRecording() {
    if (!currentCameraStream) return;
    isRecording = true;
    recordedChunks = [];
    currentMediaType = 'video';
    
    const innerCircle = document.getElementById('capture-inner-circle');
    innerCircle.classList.remove('bg-white');
    innerCircle.style.backgroundColor = '#a855f7'; 
    innerCircle.classList.add('scale-75'); 
    
    const ring = document.getElementById('capture-progress-ring');
    ring.classList.remove('opacity-0');
    
    const circle = ring.querySelector('circle');
    circle.style.transition = 'none';
    circle.style.strokeDashoffset = '239';
    void circle.offsetWidth; 
    
    circle.style.transition = 'stroke-dashoffset 30s linear';
    circle.style.strokeDashoffset = '0';

  // 🚀 STABILITY FIX: Record the raw hardware stream directly. Do not use Canvas capture.
    let streamToRecord = currentCameraStream;

    // 🚀 FIX: If software zoom was used, reset it for video since it won't be recorded natively!
    if (!isHardwareZoomActive && videoZoomScale > 1) {
        videoZoomScale = 1;
        const video = document.getElementById('hotpost-camera-feed');
        if (video) video.style.transform = currentFacingMode === 'user' ? `scaleX(-1) scale(1)` : `scale(1)`;
        import('./ui.js').then(({ showToast }) => showToast('Software zoom is disabled for videos to maintain quality.', 'info'));
    }

   // 🚀 FIX: Increased bitrate to 4 Mbps for much higher local video quality
    let options = { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 4000000 };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/mp4', videoBitsPerSecond: 4000000 }; 
    }
    try { 
        mediaRecorder = new MediaRecorder(streamToRecord, options); 
    } catch(e) { 
        mediaRecorder = new MediaRecorder(streamToRecord); 
    }

    mediaRecorder.ondataavailable = (e) => { 
        if (e.data && e.data.size > 0) recordedChunks.push(e.data); 
    };
    
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
        currentPhotoBlob = blob;
        
        if (currentPreviewObjectURL) URL.revokeObjectURL(currentPreviewObjectURL);
        currentPreviewObjectURL = URL.createObjectURL(blob);
        
        const videoEl = document.getElementById('hotpost-preview-video');
        videoEl.src = currentPreviewObjectURL;
        
        videoEl.onloadeddata = () => {
            // Apply the software zoom purely via CSS instead of burning it into the file
            const reviewScale = isHardwareZoomActive ? 1 : videoZoomScale;
            imgTransform = { scale: reviewScale, x: 0, y: 0 };
            videoEl.style.transform = `translate(0px, 0px) scale(${reviewScale})`;
             
            videoEl.play().catch(e => console.error("Playback blocked:", e));
            showPreviewUI();
            initDoodleCanvas();
        }
    };
    
    mediaRecorder.start(500); 
    recordingTimer = setTimeout(() => { if (isRecording) stopRecording(); }, 30000); 
}

function stopRecording() {
    isRecording = false;
    clearTimeout(recordingTimer);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    
    // UI Reset
    const innerCircle = document.getElementById('capture-inner-circle');
    innerCircle.style.backgroundColor = ''; 
    innerCircle.classList.add('bg-white');
    innerCircle.classList.remove('scale-75');
    
    const ring = document.getElementById('capture-progress-ring');
    if (ring) {
        ring.classList.add('opacity-0');
        const circle = ring.querySelector('circle');
        circle.style.transition = 'none';
        circle.style.strokeDashoffset = '239';
    }
}

function resetCameraUI() {
    if (currentPreviewObjectURL) {
        URL.revokeObjectURL(currentPreviewObjectURL);
        currentPreviewObjectURL = null;
    }

    document.getElementById('hotpost-camera-feed').classList.remove('hidden');
    document.getElementById('hotpost-preview-container').classList.add('hidden');
    document.getElementById('capture-ui').classList.remove('hidden');
    document.getElementById('preview-ui').classList.add('hidden');
    document.getElementById('switch-hotpost-camera-btn').classList.remove('hidden');
    document.getElementById('editor-tools-container').classList.add('hidden');
    document.getElementById('hotpost-mute-btn').classList.add('hidden'); 
    document.getElementById('undo-doodle-btn').classList.add('hidden'); 
    
    currentPhotoBlob = null;
    currentMediaType = 'image'; 
    videoZoomScale = 1;
    const video = document.getElementById('hotpost-camera-feed');
    if(video) video.style.transform = currentFacingMode === 'user' ? `scaleX(-1) scale(1)` : `scale(1)`;

    imgTransform = { scale: 1, x: 0, y: 0 };
    const previewImg = document.getElementById('hotpost-preview-img');
    const previewVideo = document.getElementById('hotpost-preview-video');
    
    if(previewImg) {
        previewImg.style.transform = `translate(0px, 0px) scale(1)`;
        previewImg.style.filter = FILTER_LIST[0].css;
        previewImg.classList.add('hidden');
    }
    if(previewVideo) {
        previewVideo.pause();
        previewVideo.removeAttribute('src'); 
        previewVideo.load();
        previewVideo.classList.add('hidden');
        previewVideo.style.filter = FILTER_LIST[0].css;
    }
    
    currentFilterIndex = 0;
    isDrawMode = false;
    doodlePaths = [];
    
    const colorPicker = document.getElementById('doodle-color-picker');
    if (colorPicker) { colorPicker.classList.add('hidden'); colorPicker.classList.remove('flex'); }
    document.getElementById('doodle-size-slider')?.classList.add('hidden');
    
    const doodleBtn = document.getElementById('doodle-hotpost-btn');
    if (doodleBtn) { doodleBtn.classList.remove('bg-white', 'text-black'); doodleBtn.classList.add('bg-black/40', 'text-white'); }
    
    document.querySelectorAll('.text-widget').forEach(el => el.remove());
    textElements = []; activeTextId = null; activeTextIdForTouch = null;

    // Reset Capture Button State
    const innerCircle = document.getElementById('capture-inner-circle');
    if(innerCircle) {
        innerCircle.style.backgroundColor = ''; 
        innerCircle.classList.add('bg-white');
        innerCircle.classList.remove('scale-75');
    }
    const ring = document.getElementById('capture-progress-ring');
    if (ring) {
        ring.classList.add('opacity-0');
        const circle = ring.querySelector('circle');
        if(circle) {
            circle.style.transition = 'none';
            circle.style.strokeDashoffset = '239';
        }
    }
}
function showPreviewUI() {
    document.getElementById('hotpost-camera-feed').classList.add('hidden');
    document.getElementById('hotpost-preview-container').classList.remove('hidden');
    document.getElementById('capture-ui').classList.add('hidden');
    document.getElementById('preview-ui').classList.remove('hidden');
    document.getElementById('preview-ui').classList.add('flex');
    document.getElementById('switch-hotpost-camera-btn').classList.add('hidden');
    document.getElementById('editor-tools-container').classList.remove('hidden');
    document.getElementById('editor-tools-container').classList.add('flex');
    
   if (currentMediaType === 'video') {
        document.getElementById('hotpost-preview-img').classList.add('hidden');
        const vidEl = document.getElementById('hotpost-preview-video');
        vidEl.classList.remove('hidden');
        
        // 🚀 FIX: Start muted so iOS/Android WebViews allow autoplay!
        vidEl.muted = true;
        const muteBtn = document.getElementById('hotpost-mute-btn');
        muteBtn.classList.remove('hidden');
        muteBtn.querySelector('span').textContent = 'volume_off';
    } else {
        document.getElementById('hotpost-preview-video').classList.add('hidden');
        document.getElementById('hotpost-preview-img').classList.remove('hidden');
        document.getElementById('hotpost-mute-btn').classList.add('hidden');
    }
}


// ==========================================
// EDITOR: FONT & TEXT ENGINE
// ==========================================
function activateTextTool(textId = null) {
    activeTextId = typeof textId === 'string' ? textId : null;
    
    const overlay = document.getElementById('hotpost-text-editor-overlay');
    const textarea = document.getElementById('hotpost-in-ui-textarea');
    
    overlay.classList.replace('hidden', 'flex');
    
    // 🚀 ALWAYS let the user type with full width, we shrink it when they hit "Done"
    textarea.style.width = '85vw'; 

    if (activeTextId) {
        const textObj = textElements.find(t => t.id === activeTextId);
        textarea.value = textObj ? textObj.content : '';
        currentTextFont = textObj.font || TEXT_FONTS[0].value;
        currentTextColor = textObj.color || '#FFFFFF';
        currentTextBg = textObj.hasBg || false;
        currentTextAlign = textObj.align || 'center';
    } else {
        textarea.value = '';
        currentTextFont = TEXT_FONTS[0].value;
        currentTextColor = '#FFFFFF';
        currentTextBg = false;
        currentTextAlign = 'center';
    }

    const alignBtnSpan = document.querySelector('#toggle-text-align-btn span');
    if (alignBtnSpan) alignBtnSpan.textContent = `format_align_${currentTextAlign}`;

    const adjustHeight = () => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    };
    textarea.removeEventListener('input', adjustHeight);
    textarea.addEventListener('input', adjustHeight);

 updateTextUIPreview();
    
    // 🚀 FIX: Call focus synchronously so mobile browsers don't block the keyboard
    textarea.focus();
    adjustHeight(); 
}

// 🚀 RESTORED MISSING FUNCTION: Handles Live UI Updates for Fonts, Alignment & Colors
function updateTextUIPreview() {
    const textarea = document.getElementById('hotpost-in-ui-textarea');
    
    // Force Font & Alignment updates overriding stubborn CSS
    textarea.style.setProperty('font-family', currentTextFont.replace(/"/g, "'"), 'important');
    textarea.style.setProperty('text-align', currentTextAlign, 'important');
    
    const isNeon = currentTextFont === TEXT_FONTS[2].value;

    if (currentTextBg) {
        textarea.style.setProperty('background-color', currentTextColor, 'important');
        textarea.style.setProperty('color', getContrastYIQ(currentTextColor), 'important');
        textarea.style.setProperty('text-shadow', 'none', 'important');
        textarea.style.setProperty('padding', '10px', 'important');
        textarea.style.setProperty('border-radius', '12px', 'important');
    } else {
        textarea.style.setProperty('background-color', 'transparent', 'important');
        textarea.style.setProperty('padding', '0', 'important');
        textarea.style.setProperty('color', currentTextColor, 'important');
        
        if (isNeon) {
            textarea.style.setProperty('text-shadow', `0 0 10px ${currentTextColor}, 0 0 20px ${currentTextColor}`, 'important');
        } else {
            textarea.style.setProperty('text-shadow', '0 4px 16px rgba(0,0,0,0.9)', 'important');
        }
    }
    
    // Update Button Selection States
    document.querySelectorAll('.text-color-btn').forEach(btn => {
        btn.style.transform = btn.dataset.color === currentTextColor ? 'scale(1.2)' : 'scale(1)';
        btn.style.border = btn.dataset.color === currentTextColor ? '2px solid white' : (btn.dataset.color === '#FFFFFF' ? '2px solid #ccc' : '2px solid transparent');
    });

    document.querySelectorAll('.text-font-btn').forEach(btn => {
        const idx = btn.dataset.fontindex;
        const isSelected = TEXT_FONTS[idx].value === currentTextFont;
        btn.style.backgroundColor = isSelected ? 'white' : 'rgba(255,255,255,0.2)';
        btn.style.color = isSelected ? 'black' : 'white';
    });

    const bgBtn = document.getElementById('toggle-text-bg-btn');
    if (bgBtn) {
        bgBtn.style.backgroundColor = currentTextBg ? 'white' : 'transparent';
        bgBtn.style.color = currentTextBg ? 'black' : 'white';
    }
}

function saveTextFromUI() {
    const textarea = document.getElementById('hotpost-in-ui-textarea');
    // Strip invisible trailing spaces that ruin alignment
    const content = textarea.value.split('\n').map(line => line.trimEnd()).join('\n').trim();
    
    if (content) {
        if (activeTextId) {
            const textObj = textElements.find(t => t.id === activeTextId);
            if (textObj) {
                textObj.content = content;
                textObj.font = currentTextFont;
                textObj.color = currentTextColor;
                textObj.hasBg = currentTextBg;
                textObj.align = currentTextAlign;
            }
        } else {
            const newId = 'text-' + Date.now();
            textElements.push({ 
                id: newId, 
                content: content, 
                x: 0.5, 
                y: 0.5, 
                scale: 1.0,
                font: currentTextFont,
                color: currentTextColor,
                hasBg: currentTextBg,
                align: currentTextAlign
            });
            activeTextId = newId; 
        }
    } else if (activeTextId) {
        textElements = textElements.filter(t => t.id !== activeTextId);
    }
    
    renderTextElements();
    document.getElementById('hotpost-text-editor-overlay').classList.replace('flex', 'hidden');
}

function renderTextElements() {
    const container = document.getElementById('hotpost-preview-container');
    container.querySelectorAll('.text-widget').forEach(el => el.remove());

    textElements.forEach(tObj => {
        const isActive = activeTextId === tObj.id;
        const widget = document.createElement('div');
        widget.className = `text-widget ${isActive ? 'active' : ''}`;
        widget.id = tObj.id;
        widget.style.left = `${tObj.x * 100}%`;
        widget.style.top = `${tObj.y * 100}%`;
        widget.style.transform = `translate(-50%, -50%) scale(${tObj.scale})`;

        const isNeon = tObj.font === TEXT_FONTS[2].value;
        let bgCSS = '';
        let shadowCSS = '';
        
        // Dynamic Padding for Backgrounds
        const paddingCSS = tObj.hasBg ? 'padding: 4px 12px; border-radius: 8px;' : 'padding: 0;';

        if (tObj.hasBg) {
            bgCSS = `background-color: ${tObj.color}; color: ${getContrastYIQ(tObj.color)}; ${paddingCSS}`;
            shadowCSS = `text-shadow: none;`;
        } else {
            bgCSS = `color: ${tObj.color};`;
            if (isNeon) {
                shadowCSS = `text-shadow: 0 0 10px ${tObj.color}, 0 0 20px ${tObj.color};`;
            } else {
                shadowCSS = `text-shadow: 0 4px 16px rgba(0,0,0,0.9);`;
            }
        }

        // Flexbox mapping aligns the individual lines perfectly
        const alignMap = { left: 'flex-start', center: 'center', right: 'flex-end' };
        const flexAlign = alignMap[tObj.align || 'center'];

        // Split text into lines so backgrounds don't bleed across empty spaces
        const linesHTML = tObj.content.split('\n').map(line => {
            const safeLine = line === '' ? '&#8203;' : line.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            return `<span style="${bgCSS} ${shadowCSS} display: inline-block; max-width: 85vw; word-wrap: break-word; white-space: pre-wrap; margin-bottom: 4px;">${safeLine}</span>`;
        }).join('');

        widget.innerHTML = `
            <div class="text-widget-box" style="display: flex; flex-direction: column; align-items: ${flexAlign}; max-width: 85vw; width: max-content;">
                <div class="text-handle handle-tl" data-action="delete"><span class="material-symbols-outlined text-[18px]">close</span></div>
                <div class="text-handle handle-tr" data-action="edit"><span class="material-symbols-outlined text-[16px]">edit</span></div>
                <div class="text-handle handle-bl" data-action="duplicate"><span class="material-symbols-outlined text-[16px]">content_copy</span></div>
                <div class="text-handle handle-br" data-action="scale"><span class="material-symbols-outlined text-[18px]">open_in_full</span></div>
                <div class="text-widget-content" style="display: flex; flex-direction: column; align-items: ${flexAlign}; font-size: 24px; font-family: ${tObj.font.replace(/"/g, "'")}; text-align: ${tObj.align || 'center'}; line-height: 1.3;">
                    ${linesHTML}
                </div>
            </div>
        `;
        container.appendChild(widget);
    });
}

function initDoodleCanvas() {
    setTimeout(() => {
        const canvas = document.getElementById('hotpost-doodle-canvas');
        const container = document.getElementById('hotpost-preview-container');
        // 🚀 FIX: Fallback to innerWidth/innerHeight prevents the 0x0 hidden container bug
        canvas.width = container.clientWidth || window.innerWidth;
        canvas.height = container.clientHeight || window.innerHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, 150); // Give the container slightly more time to paint before fetching width
}

function toggleDrawMode() {
    isDrawMode = !isDrawMode;
    const colorPicker = document.getElementById('doodle-color-picker');
    const slider = document.getElementById('doodle-size-slider');
    const penBtn = document.getElementById('doodle-hotpost-btn');
    const undoBtn = document.getElementById('undo-doodle-btn'); // 🚀 NEW
    
    if (isDrawMode) {
        colorPicker.classList.remove('hidden');
        colorPicker.classList.add('flex', 'z-[200]'); 
        slider.classList.remove('hidden');
        slider.classList.add('z-[200]');
        penBtn.classList.replace('bg-black/40', 'bg-white');
        penBtn.classList.replace('text-white', 'text-black');
        if (undoBtn) undoBtn.classList.remove('hidden'); // Show Undo
    } else {
        colorPicker.classList.add('hidden');
        colorPicker.classList.remove('flex', 'z-[200]');
        slider.classList.add('hidden');
        slider.classList.remove('z-[200]');
        penBtn.classList.replace('bg-white', 'bg-black/40');
        penBtn.classList.replace('text-black', 'text-white');
        if (undoBtn) undoBtn.classList.add('hidden'); // Hide Undo
    }
}

function setDoodleColor(color) {
    currentDoodleColor = color;
    document.querySelectorAll('.doodle-color-btn').forEach(btn => btn.classList.remove('scale-125'));
    const activeBtn = document.querySelector(`.doodle-color-btn[data-color="${color}"]`);
    if(activeBtn) activeBtn.classList.add('scale-125');
}

function undoLastDoodle() {
    if (doodlePaths.length > 0) {
        doodlePaths.pop();
        redrawDoodleCanvas();
    }
}

function redrawDoodleCanvas() {
    const canvas = document.getElementById('hotpost-doodle-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    doodlePaths.forEach(pathObj => {
        ctx.lineWidth = pathObj.width || 6;
        ctx.strokeStyle = pathObj.color;
        ctx.shadowColor = pathObj.color;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        pathObj.points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
    });
}

function setupEditorTouchPhysics() {
    const container = document.getElementById('hotpost-preview-container');
    
    let touchMode = 'idle'; 
    let startX = 0, startY = 0;
    let widgetCenterX = 0, widgetCenterY = 0;
    let hasMovedSignificantly = false; // 🚀 NEW: Touch tolerance

    const getPinchDistance = (touches) => {
        return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    };

    container.addEventListener('touchstart', (e) => {
        hasMovedSignificantly = false; // Reset threshold

        if (isDrawMode) {
            touchMode = 'draw';
            isDrawing = true;
            const rect = container.getBoundingClientRect();
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            currentPath = [{ x: startX - rect.left, y: startY - rect.top }];
            return;
        }

        const handle = e.target.closest('.text-handle');
        const widget = e.target.closest('.text-widget');

        if (handle) {
            e.stopPropagation(); 
            touchMode = handle.dataset.action; 
            activeTextIdForTouch = widget.id;
            activeTextId = widget.id;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;

            if (touchMode === 'delete') {
                textElements = textElements.filter(t => t.id !== activeTextIdForTouch);
                activeTextId = null;
                const widgetEl = document.getElementById(activeTextIdForTouch);
                if (widgetEl) widgetEl.remove();
                touchMode = 'idle';
            } else if (touchMode === 'edit') {
                activateTextTool(activeTextIdForTouch); 
                touchMode = 'idle';
            } else if (touchMode === 'duplicate') {
                const tObj = textElements.find(t => t.id === activeTextIdForTouch);
                const newId = 'text-' + Date.now();
                textElements.push({...tObj, id: newId, y: tObj.y + 0.08});
                activeTextId = newId;
                renderTextElements(); 
                touchMode = 'idle';
            } else if (touchMode === 'scale') {
                const tObj = textElements.find(t => t.id === activeTextIdForTouch);
                initialTextScale = tObj.scale;
                const rect = container.getBoundingClientRect();
                widgetCenterX = rect.left + (rect.width * tObj.x);
                widgetCenterY = rect.top + (rect.height * tObj.y);
                initialPinchDist = Math.hypot(startX - widgetCenterX, startY - widgetCenterY);
            }
            return;
        }
        
        if (widget) {
            e.stopPropagation();
            const wasAlreadyActive = widget.classList.contains('active');
            touchMode = 'drag_text';
            activeTextIdForTouch = widget.id;
            activeTextId = widget.id; 
            
            document.querySelectorAll('.text-widget').forEach(el => el.classList.remove('active'));
            widget.classList.add('active');

            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            
            widget.dataset.wasActive = wasAlreadyActive;
            widget.dataset.dragged = 'false';

            const tObj = textElements.find(t => t.id === activeTextIdForTouch);
            if(tObj) {
                textInitialObjX = tObj.x;
                textInitialObjY = tObj.y;
            }
            return;
        }
        
        activeTextId = null;
        activeTextIdForTouch = null;
        document.querySelectorAll('.text-widget').forEach(el => el.classList.remove('active'));

        if (e.touches.length === 2) {
            touchMode = 'zoom_bg';
            initialPinchDist = getPinchDistance(e.touches);
            initialBgScale = imgTransform.scale;
            return;
        }

        if (e.touches.length === 1) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            touchMode = imgTransform.scale > 1.0 ? 'pan_bg' : 'swipe';
            bgDragStartX = startX;
            bgDragStartY = startY;
        }
    }, { passive: false });

    container.addEventListener('touchmove', (e) => {
        if (e.cancelable) e.preventDefault(); 
        if (touchMode === 'idle') return;

        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const rect = container.getBoundingClientRect();

        // 🚀 NEW: 10px Deadzone to prevent accidental jitter
        if (Math.abs(currentX - startX) > 10 || Math.abs(currentY - startY) > 10) {
            hasMovedSignificantly = true;
        }

        if (touchMode === 'scale') {
            const tObj = textElements.find(t => t.id === activeTextIdForTouch);
            const currentDist = Math.hypot(currentX - widgetCenterX, currentY - widgetCenterY);
            const scaleChange = currentDist / initialPinchDist;
            // Smoother scaling limit
            tObj.scale = Math.max(0.4, Math.min(8.0, initialTextScale * scaleChange)); 
            
            const widgetEl = document.getElementById(activeTextIdForTouch);
            if(widgetEl) widgetEl.style.transform = `translate(-50%, -50%) scale(${tObj.scale})`;
            return;
        }

        if (touchMode === 'drag_text' && activeTextIdForTouch && hasMovedSignificantly) {
            const widgetEl = document.getElementById(activeTextIdForTouch);
            if (widgetEl) widgetEl.dataset.dragged = 'true';

            const tObj = textElements.find(t => t.id === activeTextIdForTouch);
            if (tObj) {
                const deltaX = (currentX - startX) / rect.width;
                const deltaY = (currentY - startY) / rect.height;
                // Allow dragging slightly off-screen without breaking layout
                tObj.x = Math.max(-0.5, Math.min(1.5, textInitialObjX + deltaX)); 
                tObj.y = Math.max(-0.5, Math.min(1.5, textInitialObjY + deltaY));
                
                if(widgetEl) {
                    widgetEl.style.left = `${tObj.x * 100}%`;
                    widgetEl.style.top = `${tObj.y * 100}%`;
                }
            }
            return;
        } 

       if (touchMode === 'zoom_bg' && e.touches.length === 2) {
            const currentDist = getPinchDistance(e.touches);
            const scaleChange = currentDist / initialPinchDist;
            imgTransform.scale = Math.max(1.0, Math.min(4.0, initialBgScale * scaleChange));
            if (imgTransform.scale === 1.0) { imgTransform.x = 0; imgTransform.y = 0; }
            
            const transformStr = `translate(${imgTransform.x}px, ${imgTransform.y}px) scale(${imgTransform.scale})`;
            document.getElementById('hotpost-preview-img').style.transform = transformStr;
            document.getElementById('hotpost-preview-video').style.transform = transformStr;
            return;
        }

        if (touchMode === 'pan_bg' && hasMovedSignificantly) {
            imgTransform.x += currentX - bgDragStartX;
            imgTransform.y += currentY - bgDragStartY;
            bgDragStartX = currentX;
            bgDragStartY = currentY;
            
            const transformStr = `translate(${imgTransform.x}px, ${imgTransform.y}px) scale(${imgTransform.scale})`;
            document.getElementById('hotpost-preview-img').style.transform = transformStr;
            document.getElementById('hotpost-preview-video').style.transform = transformStr;
            return;
        }
        
        if (touchMode === 'draw' && isDrawing) {
            currentPath.push({ x: currentX - rect.left, y: currentY - rect.top });
            const ctx = document.getElementById('hotpost-doodle-canvas').getContext('2d');
            ctx.lineJoin = "round"; ctx.lineCap = "round"; 
            ctx.lineWidth = currentDoodleWidth; 
            ctx.strokeStyle = currentDoodleColor; ctx.shadowColor = currentDoodleColor; ctx.shadowBlur = 4;
            
            ctx.beginPath();
            const prev = currentPath[currentPath.length - 2];
            const curr = currentPath[currentPath.length - 1];
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            ctx.stroke();
        }
    }, { passive: false });
    
    container.addEventListener('touchend', (e) => {
        if (touchMode === 'drag_text' && activeTextIdForTouch) {
            const widgetEl = document.getElementById(activeTextIdForTouch);
            // Open editor ONLY if they tapped it without dragging significantly
            if (widgetEl && widgetEl.dataset.wasActive === 'true' && widgetEl.dataset.dragged === 'false') {
                activateTextTool(activeTextIdForTouch);
            }
        }

        if (touchMode === 'draw' && isDrawing) {
            isDrawing = false;
            if (currentPath.length > 1) doodlePaths.push({ color: currentDoodleColor, width: currentDoodleWidth, points: [...currentPath] });
            currentPath = [];
        }
        else if (touchMode === 'swipe' && !isDrawMode && hasMovedSignificantly) {
            const endX = e.changedTouches[0].clientX;
            const deltaX = endX - startX;

            // 🚀 NEW: Increased swipe threshold so users don't accidentally switch filters
            if (Math.abs(deltaX) > 80) { 
                if (deltaX < 0) currentFilterIndex = (currentFilterIndex + 1) % FILTER_LIST.length; 
                else currentFilterIndex = (currentFilterIndex - 1 + FILTER_LIST.length) % FILTER_LIST.length; 
                
                const filter = FILTER_LIST[currentFilterIndex];
                document.getElementById('hotpost-preview-img').style.filter = filter.css;
                showFilterToast(filter.name);
            }
        }
        
        if (e.touches.length === 0) {
            touchMode = 'idle';
        }
    }, { passive: true });
}


function showFilterToast(name) {
    const toast = document.getElementById('filter-name-toast');
    toast.textContent = name;
    toast.classList.remove('hidden');
    toast.style.animation = 'none';
    toast.offsetHeight; 
    toast.style.animation = 'fadeOutUp 1s ease-out forwards';
}

// ==========================================
// BACKGROUND UPLOADING ENGINE (Image & Video)
// ==========================================
async function submitHotpost() {
    if (!currentPhotoBlob) return;

    const visibilityBtn = document.getElementById('hotpost-send-visibility');
    const rewatchBtn = document.getElementById('hotpost-rewatch-toggle');
    const visibility = visibilityBtn ? visibilityBtn.dataset.val : 'everyone';
    const allowRewatch = rewatchBtn ? rewatchBtn.dataset.val === 'true' : true; 

    const previewContainer = document.getElementById('hotpost-preview-container');
    const screenW = previewContainer.clientWidth;
    const screenH = previewContainer.clientHeight;

    isUploadingBackground = true;
    renderHotpostCircles(); 
    closeCameraModal(true);
    
    await new Promise(resolve => setTimeout(resolve, 50));
    
    try {
        let finalMediaUrl = '';
        let finalOverlayUrl = null; // 🚀 NEW: Track overlay separately
        
        // --- HELPER: DRAWS TEXT & DOODLES ---
        const drawOverlaysToCanvas = (ctx, finalWidth, finalHeight, scaleFactor) => {
            const doodleCanvas = document.getElementById('hotpost-doodle-canvas');
            if (doodlePaths.length > 0) ctx.drawImage(doodleCanvas, 0, 0, finalWidth, finalHeight);

            textElements.forEach(tObj => {
                ctx.save(); 
                const baseFontSize = 24; 
                ctx.font = `800 ${baseFontSize}px ${tObj.font}`;
                ctx.textBaseline = "middle";
                
                const paragraphs = tObj.content.split('\n');
                let wrappedLines = [];
                const uiMaxWidth = screenW * 0.85;
                
                paragraphs.forEach(paragraph => {
                    if (!paragraph) { wrappedLines.push(''); return; }
                    const words = paragraph.split(' ');
                    let currentLine = '';
                    for (let i = 0; i < words.length; i++) {
                        const testLine = currentLine + words[i] + ' ';
                        const metrics = ctx.measureText(testLine);
                        if (metrics.width > uiMaxWidth && currentLine.length > 0) {
                            wrappedLines.push(currentLine.trimEnd());
                            currentLine = words[i] + ' ';
                        } else {
                            currentLine = testLine;
                        }
                    }
                    wrappedLines.push(currentLine.trimEnd());
                });

                let longestLineW = 0;
                wrappedLines.forEach(l => {
                    const w = ctx.measureText(l).width;
                    if (w > longestLineW) longestLineW = w;
                });

                const finalX = finalWidth * tObj.x;
                const finalY = finalHeight * tObj.y;

                ctx.translate(finalX, finalY);
                ctx.scale(scaleFactor * tObj.scale, scaleFactor * tObj.scale);

                const isNeon = tObj.font === TEXT_FONTS[2].value;
                const lineHeight = baseFontSize * 1.3; 
                const totalHeight = wrappedLines.length * lineHeight;
                const startY = -(totalHeight / 2) + (lineHeight / 2);

                ctx.textAlign = tObj.align || 'center';
                let textDrawX = 0;
                if (tObj.align === 'left') textDrawX = -(longestLineW / 2);
                if (tObj.align === 'right') textDrawX = (longestLineW / 2);

                if (tObj.hasBg) {
                    ctx.fillStyle = tObj.color;
                    ctx.shadowColor = "transparent";
                    ctx.shadowBlur = 0;
                    wrappedLines.forEach((line, index) => {
                        if(!line) return; 
                        const lineW = ctx.measureText(line).width;
                        const lineY = startY + (index * lineHeight);
                        const px = 12; 
                        const py = 6;  
                        let bgStartX = 0;
                        if (tObj.align === 'center') bgStartX = -lineW/2 - px;
                        if (tObj.align === 'left') bgStartX = textDrawX - px;
                        if (tObj.align === 'right') bgStartX = textDrawX - lineW - px;
                        ctx.beginPath();
                        ctx.roundRect(bgStartX, lineY - (lineHeight/2) - py, lineW + (px*2), lineHeight + (py*2), 8);
                        ctx.fill();
                    });
                    ctx.fillStyle = getContrastYIQ(tObj.color);
                } else {
                    ctx.fillStyle = tObj.color;
                    if (isNeon) {
                        ctx.shadowColor = tObj.color;
                        ctx.shadowBlur = 10;
                    } else {
                        ctx.shadowColor = "rgba(0,0,0,0.9)";
                        ctx.shadowBlur = 10; 
                    }
                }

                wrappedLines.forEach((line, index) => {
                    const lineY = startY + (index * lineHeight);
                    if (!tObj.hasBg && isNeon) ctx.fillText(line, textDrawX, lineY); 
                    ctx.fillText(line, textDrawX, lineY); 
                });

                ctx.restore(); 
            });
        };

        // --- MEDIA PROCESSING PIPELINE ---
        if (currentMediaType === 'video') {
            
            const hasOverlays = textElements.length > 0 || doodlePaths.length > 0;

            if (hasOverlays) {
                const overlayBlob = await new Promise((resolve) => {
                    const canvas = document.createElement('canvas');
                    const MAX_HEIGHT = 1280;
                    const scaleFactor = MAX_HEIGHT / screenH;
                    canvas.width = screenW * scaleFactor;
                    canvas.height = MAX_HEIGHT;
                    const ctx = canvas.getContext('2d');
                    
                    drawOverlaysToCanvas(ctx, canvas.width, canvas.height, scaleFactor);
                    canvas.toBlob(resolve, 'image/png'); 
                });

                const overlayForm = new FormData();
                overlayForm.append('file', overlayBlob, 'overlay.png');
                overlayForm.append('upload_preset', CLOUDINARY_HOTPOSTS_PRESET);

                const overRes = await fetch(CLOUDINARY_URL, { method: 'POST', body: overlayForm });
                const overData = await overRes.json();
                if (overData.error) throw new Error(overData.error.message);
                
                // 🚀 NEW: Save raw URL directly instead of passing to Cloudinary
                finalOverlayUrl = overData.secure_url; 
            }

         // 2. Upload Video
            const vidForm = new FormData();
            vidForm.append('file', currentPhotoBlob, 'hotpost.mp4');
            vidForm.append('upload_preset', CLOUDINARY_HOTPOSTS_PRESET);
            
            const videoUploadUrl = CLOUDINARY_URL.replace('/image/', '/video/');
            const vidRes = await fetch(videoUploadUrl, { method: 'POST', body: vidForm });
            const vidData = await vidRes.json();
            if (vidData.error) throw new Error(vidData.error.message);

          // 🚀 FIX: Removed aggressive 'eco' compression. 'q_auto' dynamically balances crisp quality and fast loading.
            finalMediaUrl = vidData.secure_url.replace('/upload/', `/upload/q_auto,vc_auto/`);
        } else {
            // ORIGINAL IMAGE BAKE LOGIC
            const finalBlob = await new Promise((resolve, reject) => {
                try {
                    const bakeCanvas = document.createElement('canvas');
                    const MAX_HEIGHT = 1280;
                    const scaleFactor = MAX_HEIGHT / screenH;
                    const finalWidth = screenW * scaleFactor;
                    const finalHeight = MAX_HEIGHT;

                    bakeCanvas.width = finalWidth;
                    bakeCanvas.height = finalHeight;
                    const ctx = bakeCanvas.getContext('2d');

                    ctx.save();
                    ctx.translate(finalWidth / 2, finalHeight / 2);
                    ctx.scale(imgTransform.scale, imgTransform.scale);
                    ctx.translate(imgTransform.x * scaleFactor, imgTransform.y * scaleFactor);
                    
                    if (FILTER_LIST[currentFilterIndex].css !== 'none') {
                        ctx.filter = FILTER_LIST[currentFilterIndex].css;
                    }
                    
                    const imgAspect = baseImageObj.width / baseImageObj.height;
                    const screenAspect = finalWidth / finalHeight;
                    let drawW, drawH;
                    
                    if (imgAspect > screenAspect) {
                        drawH = finalHeight;
                        drawW = finalHeight * imgAspect;
                    } else {
                        drawW = finalWidth;
                        drawH = finalWidth / imgAspect;
                    }
                    
                    ctx.drawImage(baseImageObj, -drawW / 2, -drawH / 2, drawW, drawH);
                    ctx.restore();

                    drawOverlaysToCanvas(ctx, finalWidth, finalHeight, scaleFactor);
                    
                    bakeCanvas.toBlob(resolve, 'image/webp', 0.65); 
                } catch (err) {
                    reject(err);
                }
            });

            const formData = new FormData();
            formData.append('file', finalBlob, 'hotpost.webp');
            formData.append('upload_preset', CLOUDINARY_HOTPOSTS_PRESET);

            const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            
            finalMediaUrl = data.secure_url.replace('/upload/', '/upload/q_auto:eco,f_auto/');
        }

        // --- SAVE TO SUPABASE ---
        const { data: newHotpost, error } = await supabase.from('hotposts').insert({
            user_id: currentUser.id,
            media_url: finalMediaUrl,
            caption: finalOverlayUrl, // 🚀 NEW: Save overlay in caption column
            media_type: currentMediaType, 
            visibility: visibility,
            allow_rewatch: allowRewatch
        }).select('id').single();

        if (error) throw error;

        if (currentUser.role === 'page' && newHotpost) {
            await supabase.rpc('notify_page_followers', {
                p_page_id: currentUser.id, p_type: 'page_new_hotpost',
                p_message: 'added a new hotpost.', p_target_id: newHotpost.id
            });
        }

        showToast('Hotpost published!', 'success');

        // 🚀 FIX: Invalidate cached hotposts so the new post shows up immediately
        invalidateHotpostsCache(currentUser.id);

    } catch (error) {
        console.error("Hotpost Compile Error:", error);
        showToast('Failed to publish hotpost.', 'error');
    } finally {
        isUploadingBackground = false;
        resetCameraUI(); 
        fetchHotposts(); 
    }
}

window.toggleRewatchSetting = function() {
    const btn = document.getElementById('hotpost-rewatch-toggle');
    const icon = document.getElementById('rewatch-icon');
    
    if(btn.dataset.val === 'false') {
        btn.dataset.val = 'true';
        icon.textContent = 'all_inclusive';
        showToast('Rewatch Allowed (Post will stay for 24hrs)', 'info');
    } else {
        btn.dataset.val = 'false';
        icon.textContent = 'looks_one';
        showToast('Play Once (Post disappears after viewing)', 'info');
    }
};

window.toggleVisibilitySetting = function() {
    const btn = document.getElementById('hotpost-send-visibility');
    const icon = document.getElementById('visibility-icon');
    if(btn.dataset.val === 'everyone') {
        btn.dataset.val = 'connections';
        icon.textContent = 'stars';
        btn.classList.replace('bg-black/50', 'bg-green-500/80');
    } else {
        btn.dataset.val = 'everyone';
        icon.textContent = 'public';
        btn.classList.replace('bg-green-500/80', 'bg-black/50');
    }
};

// ==========================================
// DASHBOARD VIEW & CIRCLES
// ==========================================
async function fetchHotposts() {
    const container = document.querySelector('#hotposts-container');
    if (!container) return;

    if (!isUploadingBackground) {
        container.innerHTML = HOTPOST_SKELETON;
    }

    // OFFLINE MODE
    if (!navigator.onLine) {
        try {
            const cachedHotposts = await getHotpostsFromCache();

            if (cachedHotposts.length > 0) {
                hotpostsByUser = new Map(
                    cachedHotposts.map(item => [item.user_id, item.data])
                );
                renderHotpostCircles();
            } else {
                container.innerHTML =
                    `<div class="py-4 text-center text-xs text-on-surface-variant">
                        No saved hotposts
                    </div>`;
            }
        } catch (e) {
            console.error("Offline hotposts error:", e);
            container.innerHTML =
                `<div class="py-4 text-center text-xs text-error">
                    Failed to load cached hotposts
                </div>`;
        }
        return;
    }

    try {
        // Load hotposts through the data layer
        const data = await getHotposts(currentUser.id);

        const unviewedData = data.filter(post => {
            if (post.user_id === currentUser.id) return true;

            const hasViewed = post.hotpost_views.some(
                v => v.viewer_id === currentUser.id
            );

            if (!hasViewed) return true;
            if (hasViewed && post.allow_rewatch) return true;

            return false;
        });

        hotpostsByUser.clear();

        for (const post of unviewedData) {
            const userId = post.users.id;

            if (!hotpostsByUser.has(userId)) {
                hotpostsByUser.set(userId, {
                    user: post.users,
                    posts: [],
                    viewed: true
                });
            }

            const hasViewed = post.hotpost_views.some(
                v => v.viewer_id === currentUser.id
            );

            if (!hasViewed && post.user_id !== currentUser.id) {
                hotpostsByUser.get(userId).viewed = false;
            }

            hotpostsByUser.get(userId).posts.unshift({
                ...post,
                users: undefined
            });
        }

        renderHotpostCircles();

        // Save to offline cache
        const cacheArray = Array.from(hotpostsByUser.entries()).map(
            ([userId, data]) => ({
                user_id: userId,
                data: data
            })
        );

        await saveHotpostsToCache(cacheArray);

    } catch (e) {
        console.error("Hotposts fetch error:", e);

        container.innerHTML =
            `<div class="py-4 text-center text-xs text-error">
                Failed to load hotposts: ${e.message}
            </div>`;
    }
}

function renderHotpostCircles() {
    const container = document.querySelector('#view-dashboard .flex.gap-4.overflow-x-auto');
    if (!container) return;
    container.innerHTML = ''; 

    const addCircle = document.createElement('div');
    // 🚀 FIX: Disable pointer events if uploading to prevent double-taps
    addCircle.className = `hotpost-circle flex flex-col items-center gap-1.5 shrink-0 transition-transform relative z-20 ${isUploadingBackground ? 'pointer-events-none opacity-80' : 'cursor-pointer active:scale-95'}`;
    
    if (isUploadingBackground) {
        addCircle.innerHTML = `
            <div class="w-[80px] h-[80px] relative flex items-center justify-center pointer-events-none shadow-sm">
                <div class="absolute inset-0 rounded-full hotpost-uploading-ring"></div>
                <div class="w-[74px] h-[74px] rounded-full border-2 border-white dark:border-[#121212] overflow-hidden bg-gray-100 dark:bg-neutral-800 z-10">
                    <img src="${currentUser.profile_img_url}" class="w-full h-full object-cover opacity-60">
                </div>
            </div>
            <span class="text-[11px] font-bold text-on-surface-variant dark:text-gray-400">Uploading...</span>
        `;
    } else {
        addCircle.innerHTML = `
            <div class="w-[80px] h-[80px] rounded-full p-[2.5px] bg-transparent shadow-sm relative">
                <div class="w-full h-full rounded-full border-2 border-surface-variant dark:border-neutral-700 overflow-hidden bg-gray-100 dark:bg-neutral-800">
                    <img src="${currentUser.profile_img_url}" class="w-full h-full object-cover opacity-60">
                </div>
                <div class="absolute bottom-0 right-0 w-7 h-7 bg-primary text-white rounded-full border-[2.5px] border-white dark:border-[#121212] flex items-center justify-center z-30 shadow-sm">
                    <span class="material-symbols-outlined text-[16px] font-bold">add</span>
                </div>
            </div>
            <span class="text-[11px] font-bold text-gray-900 dark:text-gray-100">Create</span>
        `;
        addCircle.addEventListener('click', openCameraModal);
    }
    container.appendChild(addCircle);

    const myData = hotpostsByUser.get(currentUser.id);
    if (myData && myData.posts.length > 0) {
        const myCircle = document.createElement('div');
        myCircle.className = 'hotpost-circle flex flex-col items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition-transform relative z-10';
        const ringClass = myData.viewed ? 'from-gray-300 to-gray-400' : 'from-gray-400 to-gray-600';
        myCircle.innerHTML = `
            <div class="w-[80px] h-[80px] rounded-full p-[2.5px] bg-gradient-to-tr ${ringClass} shadow-sm relative">
                <div class="w-full h-full rounded-full border-2 border-white dark:border-neutral-900 overflow-hidden bg-gray-100 dark:bg-neutral-800">
                    <img src="${currentUser.profile_img_url}" class="w-full h-full object-cover">
                </div>
            </div>
            <span class="text-[11px] font-bold text-gray-900 dark:text-gray-100">My Hotposts</span>
        `;
        myCircle.addEventListener('click', () => openHotpostViewer(currentUser.id));
        container.appendChild(myCircle);
    }

    const otherUserIds = Array.from(hotpostsByUser.keys()).filter(id => id !== currentUser.id);
    otherUserIds.sort((a, b) => (hotpostsByUser.get(a).viewed || false) - (hotpostsByUser.get(b).viewed || false));

    otherUserIds.forEach(userId => {
        const data = hotpostsByUser.get(userId);
        const user = data.user;
        const circle = document.createElement('div');
        circle.className = 'hotpost-circle flex flex-col items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition-transform relative z-10';

        const ringClass = data.viewed ? 'from-gray-300 to-gray-400' : 'from-yellow-400 via-orange-500 to-red-500';

        circle.innerHTML = `
            <div class="w-[80px] h-[80px] rounded-full p-[2.5px] bg-gradient-to-tr ${ringClass} shadow-sm">
                <div class="w-full h-full rounded-full border-2 border-white dark:border-neutral-900 overflow-hidden bg-gray-100 dark:bg-neutral-800">
                    <img src="${user.profile_img_url}" class="w-full h-full object-cover">
                </div>
            </div>
            <span class="text-[11px] font-bold text-gray-900 dark:text-gray-100">${user.full_name.split(' ')[0]}</span>
        `;
        circle.addEventListener('click', () => openHotpostViewer(userId));
        container.appendChild(circle);
    });

    setTimeout(() => {
        if (window.requestIdleCallback) {
            window.requestIdleCallback(preloadHotpostImages);
        } else {
            preloadHotpostImages();
        }
    }, 1000); 
}

function preloadHotpostImages() {
    // 🚀 FIX: Only preload the first 3 users' stories to prevent network thread bottlenecking!
    let count = 0;
    
    for (const [userId, data] of hotpostsByUser.entries()) {
        if (count >= 3) break; // Stop after 3 users
        
        if (data.posts && data.posts.length > 0) {
            const firstPost = data.posts[0];
            
            // Skip preloading if it's a video to save bandwidth
            if (firstPost.media_type === 'video' || firstPost.media_url.includes('.mp4') || firstPost.media_url.includes('.webm')) {
                continue;
            }

            const optimizedUrl = typeof window.optimizeImageUrl === 'function' 
                ? window.optimizeImageUrl(firstPost.media_url, 'hotpost') 
                : firstPost.media_url;
            
            const img = new Image();
            img.src = optimizedUrl;
            count++;
        }
    }
}
// ==========================================
// VIEWER ENGINES & PHYSICS
// ==========================================
function setupViewerTouchPhysics() {
    const viewer = document.getElementById('modal-view-hotpost');
    const viewerContent = document.getElementById('hotpost-viewer-content');
    const activityModal = document.getElementById('modal-story-details');
    const activitySheet = document.getElementById('modal-story-details-sheet');
    
    let viewerStartY = 0;
    let isDraggingViewer = false;

    let panelStartY = 0;
    let isDraggingPanel = false;
    let isPanelScrollable = false;

    viewer?.addEventListener('touchstart', (e) => {
        if (!activityModal.classList.contains('hidden')) return;
        
        // 🚀 CRITICAL FIX: Tell the drag engine to ignore touches on the Avatar & Name!
        const isIgnoredTarget = 
            e.target.closest('button:not(#hotpost-activity-btn)') || 
            e.target.closest('input') || 
            e.target.closest('#hotpost-viewer-avatar') || 
            e.target.closest('#hotpost-viewer-name');
            
        if (isIgnoredTarget) return;
        
        viewerStartY = e.touches[0].clientY;
        isDraggingViewer = true;
        if (viewerContent) viewerContent.style.transition = 'none'; 
    }, { passive: true });
    
    viewer?.addEventListener('touchmove', (e) => {
        if (!isDraggingViewer) return;
        const deltaY = e.touches[0].clientY - viewerStartY;

        if (deltaY > 0) {
            const progress = Math.min(deltaY / window.innerHeight, 1);
            if (viewerContent) {
                viewerContent.style.transform = `translateY(${deltaY * 0.8}px) scale(${1 - (progress * 0.15)})`;
            }
            if (e.cancelable) e.preventDefault(); 
        } 
    }, { passive: false });

    viewer?.addEventListener('touchend', (e) => {
        if (!isDraggingViewer) return;
        isDraggingViewer = false;
        
        const deltaY = e.changedTouches[0].clientY - viewerStartY;
        const isActivityBtn = e.target.closest('#hotpost-activity-btn');
        
        const screenHeight = window.innerHeight;
        const startedAtBottom = viewerStartY > (screenHeight * 0.7);

        if (viewerContent) viewerContent.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

        if (deltaY < -40 && currentViewerState.userId === currentUser.id && (startedAtBottom || isActivityBtn)) {
            if (viewerContent) viewerContent.style.transform = ''; 
            openActivityPanel();
        } 
        else if (deltaY > 100) {
            closeHotpostViewer();
        } 
        else {
            if (viewerContent) viewerContent.style.transform = '';
        }
    }, { passive: true });

    activitySheet?.addEventListener('touchstart', (e) => {
        const scrollArea = e.target.closest('.overflow-y-auto');
        if (scrollArea && scrollArea.scrollTop > 0) {
            isPanelScrollable = true;
            isDraggingPanel = false;
        } else {
            isPanelScrollable = false;
            panelStartY = e.touches[0].clientY;
            isDraggingPanel = true;
            activitySheet.style.transition = 'none'; 
            if (viewerContent) viewerContent.style.transition = 'none';
        }
    }, { passive: true });

    activitySheet?.addEventListener('touchmove', (e) => {
        if (isPanelScrollable || !isDraggingPanel) return;
        const deltaY = e.touches[0].clientY - panelStartY;
        
        if (deltaY > 0) {
            activitySheet.style.transform = `translateY(${deltaY}px)`;
            const progress = deltaY / window.innerHeight;
            if(viewerContent) {
                viewerContent.style.transform = `scale(${0.92 + (0.08 * progress)}) translateY(${2 - (2 * progress)}vh)`;
                viewerContent.style.opacity = 0.4 + (0.6 * progress);
            }
            if (e.cancelable) e.preventDefault(); 
        }
    }, { passive: false });

    activitySheet?.addEventListener('touchend', (e) => {
        if (isPanelScrollable || !isDraggingPanel) return;
        isDraggingPanel = false;
        
        const deltaY = e.changedTouches[0].clientY - panelStartY;
        
        activitySheet.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)'; 
        if(viewerContent) {
            viewerContent.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease, border-radius 0.4s ease';
        }
        
        if (deltaY > 120) {
            closeActivityPanel();
        } 
        else {
            activitySheet.style.transform = `translateY(0px)`;
            if (viewerContent) {
                viewerContent.style.transform = '';
                viewerContent.style.opacity = '';
                viewerContent.classList.add('viewer-pushed-back');
            }
        }
    }, { passive: true });
}

async function openHotpostViewer(userId, targetPostId = null) {
    const userData = hotpostsByUser.get(userId);
    if (!userData || userData.posts.length === 0) {
        if (targetPostId) showToast('This Hotpost is no longer available.', 'error');
        return;
    }
    if (targetPostId && !userData.posts.some(p => p.id === targetPostId)) {
        showToast('This Hotpost is no longer available.', 'error');
        return;
    }

    // Refresh who I'm connected to — gates the reply box (connections-only,
    // same rule as DMs). Cache-backed in data-layer.js, so this is cheap
    // on repeat opens.
    try {
        const connections = await getAcceptedConnections(currentUser.id);
        myConnectionIds = new Set(connections.map(c => c.id));
    } catch (e) {
        console.error('Error loading connections for story replies:', e);
    }

    const allUserIds = Array.from(hotpostsByUser.keys())
        .filter(id => id !== currentUser.id)
        .sort((a, b) => (hotpostsByUser.get(a).viewed || false) - (hotpostsByUser.get(b).viewed || false));

    if (userId === currentUser.id) allUserIds.unshift(currentUser.id);

    const clickedUserIndex = allUserIds.indexOf(userId);
    currentViewerState.userOrder = [
        ...allUserIds.slice(clickedUserIndex),
        ...allUserIds.slice(0, clickedUserIndex)
    ];

    // 🚀 SMART INDEXING: jump to a specific post if requested (e.g. tapping
    // a story-reply preview in a chat), else start at the first unviewed
    let startPostIndex = 0;
    if (targetPostId) {
        const idx = userData.posts.findIndex(p => p.id === targetPostId);
        if (idx !== -1) startPostIndex = idx;
    } else if (userId !== currentUser.id) {
        const firstUnviewedIndex = userData.posts.findIndex(p => {
            const hasViewed = p.hotpost_views?.some(v => v.viewer_id === currentUser.id) || sessionViewedPostIds.has(p.id);
            return !hasViewed; // Return true if NOT viewed
        });
        if (firstUnviewedIndex !== -1) startPostIndex = firstUnviewedIndex;
    }

    document.getElementById('modal-view-hotpost').classList.replace('hidden', 'flex');
    toggleCameraStatusBar(true); 
    playUserStories(0, startPostIndex); 
}

function closeHotpostViewer() {
    document.getElementById('modal-view-hotpost').classList.replace('flex', 'hidden');
    clearTimeout(currentViewerState.storyTimer);

    // 🚀 FIX: Force pause video, wipe source, and unload to kill background audio
    const vidEl = document.getElementById('hotpost-viewer-video');
    if (vidEl) {
        vidEl.pause();
        vidEl.removeAttribute('src'); 
        vidEl.load(); 
    }

    const activeBar = document.querySelector('#hotpost-progress-bars .progress-bar-inner.active');
    if (activeBar) activeBar.style.animation = 'none';
    
    const viewerContent = document.getElementById('hotpost-viewer-content');
    if (viewerContent) {
        viewerContent.style.transform = '';
        viewerContent.style.opacity = '';
        viewerContent.style.transition = '';
        viewerContent.classList.remove('viewer-pushed-back');
    }
    
    processStoryDisappear();
    toggleCameraStatusBar(false);
}

function processStoryDisappear() {
    const lastViewedUser = currentViewerState.userId;
    if (lastViewedUser && lastViewedUser !== currentUser.id) {
        const userData = hotpostsByUser.get(lastViewedUser);
        if (userData) {
            userData.posts = userData.posts.filter(p => {
                const viewed = p.hotpost_views?.some(v => v.viewer_id === currentUser.id) || sessionViewedPostIds.has(p.id);
                return !viewed || p.allow_rewatch;
            });
            
            if (userData.posts.length === 0) {
                hotpostsByUser.delete(lastViewedUser);
            } else {
                userData.viewed = true; 
            }
            renderHotpostCircles();
        }
    }
}

function playUserStories(userIndex, postIndex = 0) {
    if (userIndex >= currentViewerState.userOrder.length) {
        closeHotpostViewer();
        return;
    }

    currentViewerState.userIndex = userIndex;
    currentViewerState.postIndex = postIndex;
    currentViewerState.userId = currentViewerState.userOrder[userIndex];

    const userData = hotpostsByUser.get(currentViewerState.userId);
    const post = userData.posts[currentViewerState.postIndex];

    const progressContainer = document.getElementById('hotpost-progress-bars');
    
    progressContainer.innerHTML = userData.posts.map((p, index) => `
        <div class="flex-1 bg-white/30 rounded-full overflow-hidden">
            <div class="progress-bar-inner h-full bg-white rounded-full ${index < postIndex ? 'w-full' : 'w-0'}" data-index="${index}"></div>
        </div>
    `).join('');

    const isMyStory = currentViewerState.userId === currentUser.id;
    const canReply = !isMyStory && myConnectionIds.has(currentViewerState.userId);

    document.getElementById('hotpost-reply-container').style.display = isMyStory ? 'none' : 'flex';
    document.getElementById('hotpost-reply-input').style.display = canReply ? 'block' : 'none';
    document.getElementById('hotpost-reply-btn').style.display = canReply ? 'flex' : 'none';
    document.getElementById('hotpost-activity-btn').style.display = isMyStory ? 'flex' : 'none';
    
    const visIcon = document.getElementById('hotpost-viewer-visibility');
    if (post.visibility === 'connections') {
        visIcon.textContent = 'stars';
        visIcon.classList.add('text-green-400');
        visIcon.classList.remove('text-white/80');
    } else {
        visIcon.textContent = 'public';
        visIcon.classList.remove('text-green-400');
        visIcon.classList.add('text-white/80');
    }

    const likeBtnIcon = document.querySelector('#hotpost-like-btn span');
    if(likeBtnIcon) {
        likeBtnIcon.style.fontVariationSettings = "'FILL' 0";
        likeBtnIcon.classList.remove('text-red-500');
    }

    const getTickHtmlLocal = (tickType) => window.getTickHtml ? window.getTickHtml(tickType) : '';

    const avatarEl = document.getElementById('hotpost-viewer-avatar');
    const nameEl = document.getElementById('hotpost-viewer-name');
    
    const openProfileHandler = (e) => {
        e.preventDefault();  
        e.stopPropagation(); 
        closeHotpostViewer(); 
        setTimeout(() => {
            if (typeof window.viewUserProfile === 'function') {
                window.viewUserProfile(userData.user.id);
            }
        }, 150); 
    };

    if (avatarEl) {
        avatarEl.src = userData.user.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.user.full_name)}&background=e1e3e4`;
        avatarEl.onclick = openProfileHandler;
        avatarEl.classList.add('cursor-pointer', 'active:scale-90', 'transition-transform', 'relative', 'z-[100]', 'pointer-events-auto');
    }
    
    if (nameEl) {
        if (isMyStory) {
            nameEl.innerHTML = `Your Hotpost`;
        } else {
            nameEl.innerHTML = `${userData.user.full_name} ${getTickHtmlLocal(userData.user.tick_type)}`;
        }
        nameEl.onclick = openProfileHandler;
        nameEl.classList.add('cursor-pointer', 'active:scale-95', 'transition-opacity', 'relative', 'z-[100]', 'pointer-events-auto');
    }
    
    document.getElementById('hotpost-viewer-time').textContent = timeAgo(post.created_at);

    clearTimeout(currentViewerState.storyTimer);
    const activeBar = progressContainer.querySelector(`.progress-bar-inner[data-index="${postIndex}"]`);
    if (activeBar) {
        activeBar.style.animation = 'none';
        activeBar.style.width = '0%';
    }

    const imgEl = document.getElementById('hotpost-viewer-image');
    const vidEl = document.getElementById('hotpost-viewer-video');
    const overlayEl = document.getElementById('hotpost-viewer-overlay'); // 🚀 NEW
    
    imgEl.style.opacity = '0';
    imgEl.style.transition = 'opacity 0.2s ease';
    vidEl.style.opacity = '0';
    vidEl.style.transition = 'opacity 0.2s ease';
    overlayEl.style.opacity = '0'; // 🚀 NEW
    
    imgEl.classList.add('hidden');
    vidEl.classList.add('hidden');
    overlayEl.classList.add('hidden'); // 🚀 NEW
    overlayEl.src = '';
    
    vidEl.pause();
    vidEl.onloadeddata = null;
    vidEl.ontimeupdate = null;
    vidEl.onended = null;
    
    if (post.media_type === 'video' || post.media_url.includes('.mp4') || post.media_url.includes('.webm')) {
        vidEl.classList.remove('hidden');
        vidEl.src = post.media_url; 
        
        // 🚀 NEW: Stack the overlay if it exists
        if (post.caption) {
            overlayEl.src = post.caption;
            overlayEl.classList.remove('hidden');
        }
        
        vidEl.onloadeddata = () => {
            vidEl.style.opacity = '1';
            if (post.caption) overlayEl.style.opacity = '1'; // Show overlay
            recordView(post.id);
            vidEl.play();
            if (activeBar) activeBar.classList.add('active');
        };

        vidEl.ontimeupdate = () => {
            if (activeBar && vidEl.duration) {
                const percentage = (vidEl.currentTime / vidEl.duration) * 100;
                activeBar.style.width = `${percentage}%`;
            }
        };

        vidEl.onended = () => {
            if (activeBar) activeBar.style.width = '100%';
            nextStory();
        };

    } else {
        imgEl.classList.remove('hidden');
        const optimizedUrl = typeof window.optimizeImageUrl === 'function' ? window.optimizeImageUrl(post.media_url, 'hotpost') : post.media_url;
        
        imgEl.onload = () => {
            imgEl.style.opacity = '1';
            recordView(post.id);
            
            currentViewerState.storyDuration = 5000; 
            currentViewerState.remainingDuration = currentViewerState.storyDuration;
            
            if (activeBar) {
                activeBar.style.animation = `fill-progress ${currentViewerState.storyDuration}ms linear forwards`;
                activeBar.classList.add('active');
            }
            
            currentViewerState.animationStartTime = performance.now();
            currentViewerState.storyTimer = setTimeout(nextStory, currentViewerState.storyDuration);
        };
        imgEl.src = optimizedUrl;
    }
}

function nextStory() {
    const currentUserData = hotpostsByUser.get(currentViewerState.userId);
    
    // If current user has more stories, play next
    if (currentViewerState.postIndex < currentUserData.posts.length - 1) {
        playUserStories(currentViewerState.userIndex, currentViewerState.postIndex + 1);
    } 
    // Move to the next user in the queue
    else {
        processStoryDisappear();
        const nextUserIndex = currentViewerState.userIndex + 1;
        
        if (nextUserIndex < currentViewerState.userOrder.length) {
            const nextUserId = currentViewerState.userOrder[nextUserIndex];
            const nextUserData = hotpostsByUser.get(nextUserId);

            // 🚀 FIX: Instagram Logic - Find the first unviewed post for the next user
            let startPostIndex = 0;
            if (nextUserId !== currentUser.id) {
                const firstUnviewedIndex = nextUserData.posts.findIndex(p => {
                    return !p.hotpost_views?.some(v => v.viewer_id === currentUser.id) && !sessionViewedPostIds.has(p.id);
                });
                
                // If they have unviewed posts, start there.
                if (firstUnviewedIndex !== -1) {
                    playUserStories(nextUserIndex, firstUnviewedIndex);
                } else {
                    // If all are viewed, completely skip this user and check the next one
                    currentViewerState.userIndex = nextUserIndex; 
                    nextStory(); 
                }
            } else {
                playUserStories(nextUserIndex, 0); // Always play own stories from beginning
            }
        } else {
            closeHotpostViewer();
        }
    }
}

function prevStory() {
    if (currentViewerState.postIndex > 0) {
        playUserStories(currentViewerState.userIndex, currentViewerState.postIndex - 1);
    } else if (currentViewerState.userIndex > 0) {
        const prevUserIndex = currentViewerState.userIndex - 1;
        const prevUserData = hotpostsByUser.get(currentViewerState.userOrder[prevUserIndex]);
        playUserStories(prevUserIndex, prevUserData.posts.length - 1);
    }
}

function pauseStory() {
    clearTimeout(currentViewerState.storyTimer);
    const vidEl = document.getElementById('hotpost-viewer-video');
    
    // Pause video playback (which stops the JS progress bar automatically)
    if (!vidEl.classList.contains('hidden')) {
        vidEl.pause();
    }
    
    const activeBar = document.querySelector('#hotpost-progress-bars .progress-bar-inner.active');
    if (activeBar) {
        // Pause CSS animation ONLY if it's an image
        if (activeBar.style.animationName && activeBar.style.animationName !== 'none') {
            const elapsedTime = performance.now() - currentViewerState.animationStartTime;
            currentViewerState.remainingDuration -= elapsedTime;
            activeBar.style.animationPlayState = 'paused';
        }
    }
}

function resumeStory() {
    if (document.getElementById('modal-view-hotpost').classList.contains('hidden')) return;
    if (!document.getElementById('modal-story-details').classList.contains('hidden')) return; 

    const vidEl = document.getElementById('hotpost-viewer-video');
    
    // Resume video playback
    if (!vidEl.classList.contains('hidden')) {
        vidEl.play();
    } else {
        // Resume image CSS animation
        const activeBar = document.querySelector('#hotpost-progress-bars .progress-bar-inner.active');
        if (activeBar && activeBar.style.animationName && activeBar.style.animationName !== 'none') {
            activeBar.style.animationPlayState = 'running';
        }
        
        currentViewerState.animationStartTime = performance.now(); 
        clearTimeout(currentViewerState.storyTimer);
        currentViewerState.storyTimer = setTimeout(nextStory, currentViewerState.remainingDuration);
    }
}
    
// ==========================================
// ENGAGEMENT & ACTIVITY
// ==========================================
async function recordView(hotpostId) {
    if (currentViewerState.userId === currentUser.id) return;
    if (sessionViewedPostIds.has(hotpostId)) return;
    const { error } = await supabase.from('hotpost_views').insert({ hotpost_id: hotpostId, viewer_id: currentUser.id });
    if (!error) sessionViewedPostIds.add(hotpostId); 
}

async function handleLikeHotpost(event) {
    event.stopPropagation(); 
    if (!window.checkVerification('like stories')) return; // 🚀 Soft Restrict Check
    
    const icon = event.currentTarget.querySelector('span');
    icon.style.fontVariationSettings = "'FILL' 1";
    icon.classList.add('text-red-500');
    
    const post = hotpostsByUser.get(currentViewerState.userId).posts[currentViewerState.postIndex];
    await supabase.from('hotpost_likes').insert({ hotpost_id: post.id, user_id: currentUser.id });
}

async function handleReplyToHotpost(event) {
    event.stopPropagation(); 
    if (!window.checkVerification('reply to stories')) return; // 🚀 Soft Restrict Check
    
    const input = document.getElementById('hotpost-reply-input');
    const content = input.value.trim();
    if (!content) return;

    const userData = hotpostsByUser.get(currentViewerState.userId);
    const post = userData.posts[currentViewerState.postIndex];
    const replyBtn = document.getElementById('hotpost-reply-btn');
    const originalHtml = replyBtn.innerHTML;

    replyBtn.disabled = true;
    replyBtn.innerHTML = `<span class="material-symbols-outlined animate-spin text-white">progress_activity</span>`;

    // Story replies are just DMs now (Instagram-style) — this goes through
    // the same messages_insert_connected_sender RLS policy as any other
    // message, so it's already only possible between connections.
    const { error } = await supabase.from('messages').insert({
        sender_id: currentUser.id,
        receiver_id: userData.user.id,
        content: content,
        hotpost_reply_id: post.id
    });

    if (error) {
        const isRlsBlock = error.code === '42501' || /row-level security/i.test(error.message || '');
        showToast(isRlsBlock ? "You can only reply to a connection's story." : 'Failed to send reply.', 'error');
        replyBtn.disabled = false;
        replyBtn.innerHTML = originalHtml;
    } else {
        showToast('Reply sent!', 'success');
        input.value = '';
        if (typeof window.refreshMessages === 'function') window.refreshMessages();
        replyBtn.classList.add('!bg-green-500', 'border-transparent');
        replyBtn.innerHTML = `<span class="material-symbols-outlined text-white">check</span>`;
        setTimeout(() => {
            replyBtn.disabled = false;
            replyBtn.classList.remove('!bg-green-500', 'border-transparent');
            replyBtn.innerHTML = originalHtml;
            resumeStory();
        }, 1500);
    }
}

async function toggleCameraStatusBar(isCameraOpen) {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const StatusBar = window.Capacitor.Plugins.StatusBar;
            if (!StatusBar) return;
            
            if (isCameraOpen) {
                await StatusBar.setBackgroundColor({ color: '#000000' });
                await StatusBar.setStyle({ style: 'DARK' });
            } else {
                const isDark = document.documentElement.classList.contains('dark');
                await StatusBar.setBackgroundColor({ color: isDark ? '#121212' : '#f8f9fa' });
                await StatusBar.setStyle({ style: isDark ? 'DARK' : 'LIGHT' });
            }
        } catch (e) { console.log('Status bar override bypassed.'); }
    }
}

function openActivityPanel() {
    pauseStory();
    const modal = document.getElementById('modal-story-details');
    const sheet = document.getElementById('modal-story-details-sheet');
    const viewerContent = document.getElementById('hotpost-viewer-content');
    
    if (viewerContent) {
        viewerContent.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease, border-radius 0.4s ease';
        viewerContent.style.transform = '';
        viewerContent.style.opacity = '';
        viewerContent.classList.add('viewer-pushed-back');
    }

    modal.classList.replace('hidden', 'flex');
    setTimeout(() => sheet.style.transform = `translateY(0px)`, 10);

    const post = hotpostsByUser.get(currentUser.id).posts[currentViewerState.postIndex];
    switchDetailsTab('viewers');
    fetchStoryViewers(post.id);
    fetchStoryLikes(post.id);
}

function closeActivityPanel() {
    const modal = document.getElementById('modal-story-details');
    const sheet = document.getElementById('modal-story-details-sheet');
    const viewerContent = document.getElementById('hotpost-viewer-content');
    
    sheet.style.transform = `translateY(100%)`;
    modal.style.pointerEvents = 'none'; 
    
    if (viewerContent) {
        viewerContent.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease, border-radius 0.4s ease';
        viewerContent.style.transform = '';
        viewerContent.style.opacity = '';
        viewerContent.classList.remove('viewer-pushed-back');
    }

    setTimeout(() => {
        modal.classList.replace('flex', 'hidden');
        modal.style.pointerEvents = 'auto'; 
        resumeStory();
    }, 400); 
}

function switchDetailsTab(tabName) {
    document.querySelectorAll('.details-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`details-content-${tabName}`).classList.remove('hidden');

    document.querySelectorAll('.details-tab').forEach(el => {
        el.classList.remove('active', 'border-primary', 'text-primary');
        el.classList.add('border-transparent', 'text-on-surface-variant', 'dark:text-gray-400');
    });
    document.getElementById(`details-tab-${tabName}`).classList.add('active', 'border-primary', 'text-primary');
    document.getElementById(`details-tab-${tabName}`).classList.remove('text-on-surface-variant', 'dark:text-gray-400');
}

let currentViewersPostId = null;
let currentViewersPage = 0;
const VIEWERS_PER_PAGE = 30;

async function fetchStoryViewers(hotpostId, isLoadMore = false) {
    const list = document.getElementById('hotpost-viewers-list');
    
    if (!isLoadMore) {
        currentViewersPostId = hotpostId;
        currentViewersPage = 0;
        list.innerHTML = ACTIVITY_SKELETON; 
        
        const oldBtn = document.getElementById('load-more-viewers-btn');
        if (oldBtn) oldBtn.remove();
        
        // Fetch the total count quickly for the tab header
        supabase.from('hotpost_views').select('id', { count: 'exact', head: true }).eq('hotpost_id', hotpostId).eq('is_deleted', false)
            .then(({ count }) => {
                document.getElementById('details-tab-viewers').innerHTML = `<span class="material-symbols-outlined text-[16px] mr-1 align-middle">visibility</span> ${count || 0}`;
            });
    } else {
        const loadBtn = document.getElementById('load-more-viewers-btn');
        if (loadBtn) loadBtn.innerHTML = `<span class="material-symbols-outlined animate-spin">progress_activity</span>`;
    }

    try {
        const from = currentViewersPage * VIEWERS_PER_PAGE;
        const to = from + VIEWERS_PER_PAGE - 1;

        const { data, error } = await supabase.from('hotpost_views')
            .select('viewed_at, users!hotpost_views_viewer_id_fkey(id, full_name, profile_img_url, tick_type)')
            .eq('hotpost_id', currentViewersPostId).eq('is_deleted', false).order('viewed_at', { ascending: false })
            .range(from, to);
        
        if (error) throw error;
        
        if (!isLoadMore && data.length === 0) { 
            list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">No views yet.</p>`; 
            return; 
        }
        
        const getTick = (type) => window.getTickHtml ? window.getTickHtml(type) : '';

        const viewersHtml = data.map(v => `
            <div onclick="window.closeActivityPanel(); window.closeHotpostViewer(); setTimeout(() => window.viewUserProfile('${v.users.id}'), 150);" class="flex items-center justify-between py-3 px-2 hover:bg-surface-variant/10 dark:hover:bg-neutral-800/30 rounded-xl cursor-pointer active:scale-[0.98] transition-all">
                <div class="flex items-center gap-3.5">
                    <img src="${v.users.profile_img_url}" class="w-12 h-12 rounded-full object-cover border border-surface-variant/30">
                    <p class="text-[14.5px] font-extrabold text-on-surface dark:text-gray-100 flex items-center gap-1">${v.users.full_name} ${getTick(v.users.tick_type)}</p>
                </div>
                <p class="text-[12px] font-medium text-on-surface-variant dark:text-gray-500">${timeAgo(v.viewed_at)}</p>
            </div>
        `).join('');

        if (!isLoadMore) {
            list.innerHTML = viewersHtml;
        } else {
            const oldBtn = document.getElementById('load-more-viewers-btn');
            if (oldBtn) oldBtn.remove();
            list.insertAdjacentHTML('beforeend', viewersHtml);
        }

        if (data.length === VIEWERS_PER_PAGE) {
            currentViewersPage++;
            list.insertAdjacentHTML('beforeend', `
                <button id="load-more-viewers-btn" onclick="window.fetchStoryViewers(null, true)" class="w-full py-3 mt-2 mb-4 text-sm font-bold text-primary bg-primary/10 rounded-xl active:scale-95 transition-transform flex justify-center items-center">
                    Load More
                </button>
            `);
        }

    } catch (e) { 
        console.error(e);
        if (!isLoadMore) list.innerHTML = `<p class="text-sm text-center py-8 text-error">Failed to load viewers.</p>`; 
        else {
            const oldBtn = document.getElementById('load-more-viewers-btn');
            if(oldBtn) oldBtn.innerHTML = "Error loading. Tap to retry.";
        }
    }
}
window.fetchStoryViewers = fetchStoryViewers;

async function fetchStoryLikes(hotpostId) {
    const list = document.getElementById('hotpost-likes-list');
    list.innerHTML = ACTIVITY_SKELETON; 
    try {
        const { data, error } = await supabase.from('hotpost_likes')
            .select('created_at, users!hotpost_likes_user_id_fkey(id, full_name, profile_img_url, tick_type)')
            .eq('hotpost_id', hotpostId).eq('is_deleted', false).order('created_at', { ascending: false });
        
        if (error) throw error;
        document.getElementById('details-tab-likes').innerHTML = `<span class="material-symbols-outlined text-[16px] mr-1 align-middle">favorite</span> ${data.length}`;
        
        if (data.length === 0) { list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">No likes yet.</p>`; return; }
        
        const getTick = (type) => window.getTickHtml ? window.getTickHtml(type) : '';

        // 🚀 FIX: Added "window." to the function calls
        list.innerHTML = data.map(l => `
            <div onclick="window.closeActivityPanel(); window.closeHotpostViewer(); setTimeout(() => window.viewUserProfile('${l.users.id}'), 150);" class="flex items-center justify-between py-3 px-2 hover:bg-surface-variant/10 dark:hover:bg-neutral-800/30 rounded-xl cursor-pointer active:scale-[0.98] transition-all">
                <div class="flex items-center gap-3.5">
                    <img src="${l.users.profile_img_url}" class="w-12 h-12 rounded-full object-cover border border-surface-variant/30">
                    <p class="text-[14.5px] font-extrabold text-on-surface dark:text-gray-100 flex items-center gap-1">${l.users.full_name} ${getTick(l.users.tick_type)}</p>
                </div>
                <div class="flex items-center gap-2">
                    <p class="text-[12px] font-medium text-on-surface-variant dark:text-gray-500">${timeAgo(l.created_at)}</p>
                    <span class="material-symbols-outlined text-red-500 text-[16px]" style="font-variation-settings: 'FILL' 1;">favorite</span>
                </div>
            </div>
        `).join('');
    } catch (e) { list.innerHTML = `<p class="text-sm text-center py-8 text-error">Failed.</p>`; }
}

async function executeDeleteHotpost() {
    const post = hotpostsByUser.get(currentUser.id).posts[currentViewerState.postIndex];
    closeActivityPanel(); 
    closeHotpostViewer();
    const { error } = await supabase.from('hotposts').update({ is_deleted: true }).eq('id', post.id);
    if (error) showToast('Failed to delete Hotpost.', 'error');
    else { showToast('Hotpost deleted.', 'success'); fetchHotposts(); }
}

window.openHotpostCamera = openCameraModal;
window.openStoryDetailsModal = openActivityPanel;

window.openHotpostViewer = openHotpostViewer;
window.openHotpostFromReply = (ownerId, hotpostId) => openHotpostViewer(ownerId, hotpostId);
window.showMyHotposts = () => openHotpostViewer(currentUser.id);
window.refreshHotposts = fetchHotposts;

// 🚀 FIX: Expose these functions to the global window object
window.closeActivityPanel = closeActivityPanel;
window.closeHotpostViewer = closeHotpostViewer;
// ==========================================
// SAVE TO DEVICE ENGINE
// ==========================================
window.downloadCurrentMedia = function() {
    if (!currentPhotoBlob) {
        import('./ui.js').then(({ showToast }) => showToast('No media to save.', 'warning'));
        return;
    }
    
    const fileName = currentMediaType === 'video' ? `Hotpost_${Date.now()}.mp4` : `Hotpost_${Date.now()}.jpg`;
    
    try {
        // 🚀 ROUTE 1: Native Android App (Native Toast handles alert)
        if (window.AndroidDownloader && window.AndroidDownloader.saveBase64File) {
            const reader = new FileReader();
            reader.readAsDataURL(currentPhotoBlob);
            reader.onloadend = function() {
                window.AndroidDownloader.saveBase64File(reader.result, fileName);
            };
            return;
        }

        // 🚀 ROUTE 2: Web Browser / PWA (Browser fallback)
        const url = URL.createObjectURL(currentPhotoBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 3000);
        
        import('./ui.js').then(({ showToast }) => showToast('Saved to device!', 'success'));
    } catch (err) {
        console.error("Save Error:", err);
        import('./ui.js').then(({ showToast }) => showToast('Failed to save media.', 'error'));
    }
};
// ==========================================
// VIEWER UI HELPERS (Fades & Animations)
// ==========================================
window.toggleViewerUI = function(show) {
    // Select all the UI overlays that block the view
    const elementsToToggle = [
        document.getElementById('hotpost-progress-bars'),
        document.getElementById('close-hotpost-viewer-btn'),
        document.getElementById('hotpost-viewer-bottom-gradient'),
        document.querySelector('#hotpost-viewer-content .absolute.top-0.left-0.right-0.h-32'), // Top shadow
        document.querySelector('#hotpost-viewer-content .absolute.top-\\[max\\(1\\.5rem\\,calc\\(env\\(safe-area-inset-top\\)\\+1rem\\)\\)\\]') // User info
    ];

    elementsToToggle.forEach(el => {
        if (!el) return;
        el.style.transition = 'opacity 0.2s ease-in-out';
        el.style.opacity = show ? '1' : '0';
    });
};

window.showDoubleTapHeart = function(x, y) {
    const viewer = document.getElementById('hotpost-viewer-content');
    if (!viewer) return;

    const heart = document.createElement('span');
    heart.className = 'material-symbols-outlined absolute text-white drop-shadow-2xl z-[100] pointer-events-none';
    heart.style.fontVariationSettings = "'FILL' 1";
    heart.style.fontSize = '90px';
    heart.textContent = 'favorite';
    
    // Center the heart exactly where the user tapped
    heart.style.left = `${x - 45}px`;
    heart.style.top = `${y - 45}px`;
    heart.style.animation = 'storyDoubleTapHeart 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';

    viewer.appendChild(heart);

    // Clean up DOM after animation
    setTimeout(() => heart.remove(), 800);
};

// CLEANUP FUNCTION FOR TAB SWITCHING
window.cleanupHotpostsTab = function() {
    try {
        // Close camera if open
        if (document.getElementById('modal-hotpost-camera')?.classList.contains('flex')) {
            closeCameraModal(true);
        }
        
        // Clear recorded chunks
        recordedChunks = [];
        isRecording = false;
        
        // Revoke any preview URLs
        if (currentPreviewObjectURL) {
            URL.revokeObjectURL(currentPreviewObjectURL);
            currentPreviewObjectURL = null;
        }
        
        console.debug("Hotposts tab cleanup complete");
    } catch (e) {
        console.error("Hotposts cleanup error:", e);
    }
};
