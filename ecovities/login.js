// login.js
import { authClient } from './auth-client.js';

// If user is already logged in, redirect them to the app immediately
const checkExistingSession = async () => {
    const { data: { session } } = await authClient.auth.getSession();
    if (session) {
        window.location.replace('index.html');
    }
};
checkExistingSession();

const loginForm = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');
const errorContainer = document.getElementById('error-message');
const errorText = document.getElementById('error-text');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    // Reset UI state
    errorContainer.classList.add('hidden');
    loginBtn.disabled = true;
    loginBtn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> <span>Verifying...</span>`;
    if (window.lucide) window.lucide.createIcons();

    try {
        // 🔴 Login using the Master Auth Project
        const { data, error } = await authClient.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) throw error;

        // Success! Redirect to the main app
        window.location.replace('index.html');

    } catch (err) {
        console.error('Login error:', err.message);
        
        // Show error message
        errorText.textContent = err.message || "Invalid login credentials.";
        errorContainer.classList.remove('hidden');
        
        // Reset button
        loginBtn.disabled = false;
        loginBtn.innerHTML = `<span>Sign In</span> <i data-lucide="arrow-right" class="w-4 h-4"></i>`;
        if (window.lucide) window.lucide.createIcons();
    }
});
