import { supabase } from './supabase-client.js';
import { state } from './state.js';
import { els, getIconForChallenge, uploadToCloudinary, getTodayIST } from './utils.js';

// 1. Load Challenges
export const loadChallengesData = async () => {
    try {
        const { data: challenges, error: challengeError } = await supabase
            .from('challenges')
            .select('id, title, description, points_reward, type, frequency')
            .eq('is_active', true);
            
        if (challengeError) throw challengeError;

        const { data: submissions, error: subError } = await supabase
            .from('challenge_submissions')
            .select('challenge_id, status, created_at')
            .eq('user_id', state.currentUser.id);
            
        if (subError) throw subError;

        const todayIST = getTodayIST(); // "YYYY-MM-DD" in IST

        state.dailyChallenges = challenges.map(c => {
            // Get all submissions for this specific challenge
            const challengeSubs = submissions.filter(s => s.challenge_id === c.id);
            
            let sub = null;

            if (c.frequency === 'daily') {
                // ✅ KEY FIX: Only find submissions made TODAY.
                // If I made a submission yesterday (even if pending/verified), this returns undefined for today.
                // So 'sub' will be null, and I can upload again.
                sub = challengeSubs.find(s => {
                    const subDate = new Date(s.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
                    return subDate === todayIST;
                });
            } else {
                // For 'once', any submission counts
                sub = challengeSubs[0];
            }

            let status = 'active', buttonText = 'Start', isDisabled = false;
            
            if (sub) {
                // If we found a submission for TODAY:
                if (sub.status === 'approved' || sub.status === 'verified') { 
                    status = 'completed'; 
                    buttonText = c.frequency === 'daily' ? 'Done for Today' : 'Completed'; 
                    isDisabled = true; 
                } 
                else if (sub.status === 'pending') { 
                    status = 'pending'; 
                    buttonText = 'In Review'; 
                    isDisabled = true; 
                } 
                else if (sub.status === 'rejected') { 
                    status = 'active'; 
                    buttonText = 'Retry'; 
                }
            } else {
                // No submission found for today -> Allow Upload
                if (c.type === 'Upload') buttonText = 'Take Photo';
            }
            
            return { ...c, icon: getIconForChallenge(c.type), status, buttonText, isDisabled };
        });

        checkQuizStatus();

        if (document.getElementById('challenges').classList.contains('active')) renderChallengesPage();
    } catch (err) { console.error('Challenges Load Error:', err); }
};

// ... (Rest of logic remains the same) ...

// 2. Check Quiz Status Logic
const checkQuizStatus = async () => {
    const quizSection = document.getElementById('daily-quiz-section');
    const btn = document.getElementById('btn-quiz-play');
    if (!quizSection || !btn) return;

    try {
        const today = getTodayIST();
        
        const { data: quiz, error: quizError } = await supabase
            .from('daily_quizzes')
            .select('id')
            .eq('available_date', today)
            .limit(1)
            .single();

        if (quizError || !quiz) {
            quizSection.classList.add('hidden');
            return;
        }

        const { data: submission, error: subError } = await supabase
            .from('quiz_submissions')
            .select('id')
            .eq('quiz_id', quiz.id)
            .eq('user_id', state.currentUser.id)
            .maybeSingle();

        quizSection.classList.remove('hidden');
        
        if (submission) {
            btn.textContent = "Attempted";
            btn.disabled = true;
            btn.onclick = null;
            btn.classList.remove('bg-brand-600', 'hover:bg-brand-500', 'shadow-md');
            btn.classList.add('bg-gray-200', 'dark:bg-gray-700', 'text-gray-500', 'dark:text-gray-400', 'cursor-default');
        } else {
            btn.textContent = "Play Now";
            btn.disabled = false;
            btn.onclick = openEcoQuizModal;
            btn.classList.add('bg-brand-600', 'hover:bg-brand-500', 'shadow-md');
            btn.classList.remove('bg-gray-200', 'dark:bg-gray-700', 'text-gray-500', 'dark:text-gray-400', 'cursor-default');
        }

    } catch (err) {
        console.error("Quiz Status Check Failed:", err);
    }
};

export const renderChallengesPage = () => {
    els.challengesList.innerHTML = '';

    checkQuizStatus();

    if (state.dailyChallenges.length === 0) { els.challengesList.innerHTML = `<p class="text-sm text-center text-gray-500">No active photo challenges.</p>`; return; }
    
    state.dailyChallenges.forEach(c => {
        let buttonHTML = '';
        if (c.isDisabled) buttonHTML = `<button disabled class="text-xs font-semibold px-3 py-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300 cursor-not-allowed">${c.buttonText}</button>`;
        else if (c.type === 'Upload' || c.type === 'selfie') buttonHTML = `<button onclick="startCamera('${c.id}')" data-challenge-id="${c.id}" class="text-xs font-semibold px-3 py-2 rounded-full bg-green-600 text-white hover:bg-green-700"><i data-lucide="camera" class="w-3 h-3 mr-1 inline-block"></i>${c.buttonText}</button>`;
        else buttonHTML = `<button class="text-xs font-semibold px-3 py-2 rounded-full bg-green-600 text-white">${c.buttonText}</button>`;

        els.challengesList.innerHTML += `
            <div class="glass-card p-4 rounded-2xl flex items-start">
                <div class="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center mr-3"><i data-lucide="${c.icon}" class="w-5 h-5 text-green-600 dark:text-green-300"></i></div>
                <div class="flex-1">
                    <h3 class="font-bold text-gray-900 dark:text-gray-100">${c.title}</h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">${c.frequency === 'daily' ? '🔄 Daily Challenge' : '⭐ One-time Challenge'}</p>
                    <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">${c.description}</p>
                    <div class="flex items-center justify-between mt-3"><span class="text-xs font-semibold text-green-700 dark:text-green-300">+${c.points_reward} pts</span>${buttonHTML}</div>
                </div>
            </div>`;
    });
    if(window.lucide) window.lucide.createIcons();
};

let currentCameraStream = null;
let currentChallengeIdForCamera = null;
let currentFacingMode = 'environment';

export const startCamera = async (challengeId, facingMode = 'environment') => {
    currentChallengeIdForCamera = challengeId;
    currentFacingMode = facingMode;
    const modal = document.getElementById('camera-modal');
    
    // Safety check if modal is still missing for some reason
    if(!modal) {
        alert("Camera Error: Modal missing in HTML.");
        return;
    }
    
    const video = document.getElementById('camera-feed');
    modal.classList.remove('hidden');
    
    if (currentCameraStream) currentCameraStream.getTracks().forEach(track => track.stop());

    try {
        currentCameraStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: currentFacingMode } 
        });
        video.srcObject = currentCameraStream;
        video.style.transform = currentFacingMode === 'user' ? 'scaleX(-1)' : 'none';
    } catch (err) { 
        console.error(err);
        alert("Unable to access camera."); 
        closeCameraModal(); 
    }
};

export const switchCamera = () => {
    const newMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    startCamera(currentChallengeIdForCamera, newMode);
};

export const closeCameraModal = () => {
    const modal = document.getElementById('camera-modal');
    if (currentCameraStream) currentCameraStream.getTracks().forEach(track => track.stop());
    const video = document.getElementById('camera-feed');
    if(video) video.srcObject = null;
    if(modal) modal.classList.add('hidden');
};

export const capturePhoto = async () => {
    const video = document.getElementById('camera-feed');
    const canvas = document.getElementById('camera-canvas');
    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    
    if (currentFacingMode === 'user') {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
    }
    
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    closeCameraModal();
    
    canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], "cam.jpg", { type: "image/jpeg" });
        
        const btn = document.querySelector(`button[data-challenge-id="${currentChallengeIdForCamera}"]`);
        const originalText = btn ? btn.innerText : 'Uploading...';
        if(btn) { btn.innerText = 'Uploading...'; btn.disabled = true; }
        
        try {
            const imageUrl = await uploadToCloudinary(file);
            const { error } = await supabase.from('challenge_submissions').insert({ challenge_id: currentChallengeIdForCamera, user_id: state.currentUser.id, submission_url: imageUrl, status: 'pending' });
            if (error) throw error;
            await loadChallengesData();
            alert('Challenge submitted successfully!');
        } catch (err) {
            console.error('Camera Upload Error:', err); alert('Failed to upload photo.');
            if(btn) { btn.innerText = originalText; btn.disabled = false; }
        }
    }, 'image/jpeg', 0.8);
};

// Quiz Logic Exports
let currentQuizId = null;

export const openEcoQuizModal = async () => {
    const modal = document.getElementById('eco-quiz-modal');
    const loading = document.getElementById('eco-quiz-loading');
    const body = document.getElementById('eco-quiz-body');
    const played = document.getElementById('eco-quiz-already-played');
    
    modal.classList.remove('invisible', 'opacity-0');
    loading.classList.remove('hidden');
    body.classList.add('hidden');
    played.classList.add('hidden');

    try {
        const today = getTodayIST();
        
        const { data: quiz, error } = await supabase
            .from('daily_quizzes')
            .select('*')
            .eq('available_date', today)
            .limit(1)
            .single();

        if (error || !quiz) {
            alert("No quiz available for today!");
            closeEcoQuizModal();
            return;
        }

        currentQuizId = quiz.id;

        const { data: submission } = await supabase
            .from('quiz_submissions')
            .select('*')
            .eq('quiz_id', quiz.id)
            .eq('user_id', state.currentUser.id)
            .maybeSingle();

        loading.classList.add('hidden');

        if (submission) {
            played.classList.remove('hidden');
            checkQuizStatus();
        } else {
            body.classList.remove('hidden');
            document.getElementById('eco-quiz-question').textContent = quiz.question;
            const optsDiv = document.getElementById('eco-quiz-options');
            optsDiv.innerHTML = '';
            
            const options = Array.isArray(quiz.options) ? quiz.options : JSON.parse(quiz.options);
            
            options.forEach((opt, idx) => {
                const btn = document.createElement('button');
                btn.className = "quiz-option w-full text-left p-4 border-2 border-gray-200 dark:border-gray-700 rounded-xl font-medium text-gray-700 dark:text-gray-300 hover:border-indigo-400 dark:hover:border-indigo-500";
                btn.textContent = opt;
                btn.onclick = () => submitQuizAnswer(idx, quiz.correct_option_index, quiz.points_reward);
                optsDiv.appendChild(btn);
            });
        }
    } catch (err) {
        console.error("Quiz Error", err);
        closeEcoQuizModal();
    }
};

const submitQuizAnswer = async (selectedIndex, correctIndex, points) => {
    const isCorrect = selectedIndex === correctIndex;
    const feedback = document.getElementById('eco-quiz-feedback');
    const opts = document.querySelectorAll('.quiz-option');
    
    opts.forEach(b => b.disabled = true);
    opts[selectedIndex].classList.add(isCorrect ? 'bg-green-100' : 'bg-red-100', isCorrect ? 'border-green-500' : 'border-red-500');
    if (!isCorrect) {
        opts[correctIndex].classList.add('bg-green-100', 'border-green-500');
    }

    feedback.classList.remove('hidden');
    feedback.textContent = isCorrect ? `Correct! +${points} Points` : "Wrong Answer!";
    feedback.className = `p-4 rounded-xl text-center font-bold mb-4 ${isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`;

    await supabase.from('quiz_submissions').insert({
        quiz_id: currentQuizId,
        user_id: state.currentUser.id,
        is_correct: isCorrect
    });

    if (isCorrect) {
        await supabase.from('points_ledger').insert({
            user_id: state.currentUser.id,
            source_type: 'quiz',
            source_id: currentQuizId,
            points_delta: points,
            description: 'Daily Quiz Win'
        });
    }

    setTimeout(() => {
        closeEcoQuizModal();
        checkQuizStatus();
        import('./app.js').then(m => m.refreshUserData());
    }, 2000);
};

export const closeEcoQuizModal = () => {
    document.getElementById('eco-quiz-modal').classList.add('invisible', 'opacity-0');
    setTimeout(() => {
         const fb = document.getElementById('eco-quiz-feedback');
         if(fb) fb.classList.add('hidden');
    }, 300);
};

window.renderChallengesPageWrapper = renderChallengesPage;
window.startCamera = startCamera;
window.closeCameraModal = closeCameraModal;
window.capturePhoto = capturePhoto;
window.switchCamera = switchCamera;
window.openEcoQuizModal = openEcoQuizModal;
window.closeEcoQuizModal = closeEcoQuizModal;
