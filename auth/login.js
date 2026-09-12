// auth/login.js
import { supabase } from '../supabase.js';
const sb = supabase;

// DOM elements
let loginForm;
let loginButton;
let authMessage;

// 🔔 Show message
function showMessage(message, isError = true) {
    if (!authMessage) return;

    authMessage.textContent = message;
    authMessage.className = isError
        ? "text-red-500 text-sm text-center mb-4 h-5"
        : "text-green-500 text-sm text-center mb-4 h-5";
}

// ⏳ Button loading state
function setLoading(button, isLoading) {
    if (!button) return;

    const btnText = button.querySelector(".btn-text");
    const loader = button.querySelector("span:last-child");

    if (isLoading) {
        button.disabled = true;
        if (btnText) btnText.classList.add("hidden");
        if (loader) loader.classList.remove("hidden");
    } else {
        button.disabled = false;
        if (btnText) btnText.classList.remove("hidden");
        if (loader) loader.classList.add("hidden");
    }
}

// 🚦 STATUS CHECK & ROUTING
async function processSuccessfulLogin(session) {
    // 1. Fetch user status flags
    const { data: profile, error } = await sb
        .from('users')
        .select('id, is_deleted, is_deactivated')
        .eq('auth_user_id', session.user.id)
        .single();

    if (error || !profile) {
        console.error("Profile fetch error:", error);
        showMessage("Error validating account status.");
        setLoading(loginButton, false);
        return;
    }

    // 2. Handle Permanently Deleted Accounts
    if (profile.is_deleted) {
        await sb.auth.signOut();
        showMessage("This account has been permanently deleted.");
        setLoading(loginButton, false);
        return;
    }

    // 3. Handle Deactivated Accounts
    if (profile.is_deactivated) {
        // Hide standard login UI, show Reactivation UI
        document.getElementById('login-form').classList.add('hidden');
        document.querySelector('div.text-center.mb-8 h1').textContent = "Account Paused";
        document.querySelector('div.text-center.mb-8 p').classList.add('hidden');
        
        const reactivateContainer = document.getElementById('reactivate-container');
        reactivateContainer.classList.remove('hidden');
        reactivateContainer.classList.add('flex');
        
        showMessage("", false); // Clear errors
        setLoading(loginButton, false);

        // Reactivate Button Logic
        document.getElementById('reactivate-btn').onclick = async () => {
            const rBtn = document.getElementById('reactivate-btn');
            rBtn.textContent = "Reactivating...";
            rBtn.disabled = true;
            
            await sb.from('users').update({ is_deactivated: false }).eq('id', profile.id);
            window.location.href = "../index.html"; // Route to app
        };
        
        // Cancel Button Logic
        document.getElementById('cancel-reactivate-btn').onclick = async () => {
            await sb.auth.signOut();
            window.location.reload();
        };
        return;
    }

    // 4. All good, standard user!
    window.location.href = "../index.html";
}

// 🔐 HANDLE LOGIN
async function handleLogin(event) {
    event.preventDefault();

    const identifier = document.getElementById("login-identifier").value.trim();
    const password = document.getElementById("login-password").value;

    if (!identifier || !password) {
        showMessage("Please enter Email/Student ID and Password");
        return;
    }

    setLoading(loginButton, true);
    showMessage("", false);

    try {
        if (identifier.includes('@')) {
            // 🔥 Email Login
            const { data, error } = await sb.auth.signInWithPassword({
                email: identifier,
                password: password,
            });

            if (error) {
                console.error("Login error:", error);
                showMessage(error.message || "Invalid email or password.");
                setLoading(loginButton, false);
                return;
            }

            if (data?.session) {
                await processSuccessfulLogin(data.session);
                return;
            }
        } else {
            // 🔥 Student ID Login via Edge Function
            const { data, error } = await sb.functions.invoke(
                "hyper-endpoint",
                {
                    body: { studentId: identifier, password }
                }
            );

            if (error) {
                console.error("Function error:", error);
                showMessage("Server error. Try again.");
                setLoading(loginButton, false);
                return;
            }

            if (data?.error) {
                showMessage(data.error);
                setLoading(loginButton, false);
                return;
            }

            if (data?.session) {
                const { error: sessionError } = await sb.auth.setSession(data.session);

                if (sessionError) {
                    console.error("Session error:", sessionError);
                    showMessage("Login failed. Try again.");
                    setLoading(loginButton, false);
                    return;
                }

                await processSuccessfulLogin(data.session);
                return;
            }
        }

        showMessage("Unexpected error occurred.");
        setLoading(loginButton, false);

    } catch (err) {
        console.error("Login error:", err);
        showMessage("Something went wrong.");
        setLoading(loginButton, false);
    }
}

// 🔁 Check existing session on load
async function checkUserSession() {
    try {
        const { data } = await sb.auth.getSession();
        if (data?.session) {
            // Check status before letting them in!
            await processSuccessfulLogin(data.session);
        }
    } catch (err) {
        console.error("Session check error:", err);
    }
}

// 🚀 INIT
document.addEventListener("DOMContentLoaded", () => {
    loginForm = document.getElementById("login-form");
    loginButton = document.getElementById("login-button");
    authMessage = document.getElementById("auth-message");

    if (!loginForm) {
        console.error("Login form not found!");
        return;
    }

    loginForm.addEventListener("submit", handleLogin);

    // Securely check session on boot
    checkUserSession();
});
