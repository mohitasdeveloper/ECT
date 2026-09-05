// auth/signup.js
import { supabase } from '../supabase.js';
const sb = supabase; // Keep using 'sb' for consistency in the file

// DOM elements
let signupForm;
let signupButton;
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

// 🟢 Load colleges dynamically from the 'colleges' table
function loadColleges() {
    const select = document.getElementById("signup-college");
    if (!select) return;

    // Set the only option and select it
    select.innerHTML = `<option value="B. K. Birla Night College" selected>B. K. Birla Night College</option>`;

    // Disable the dropdown as there are no other choices
    select.disabled = true;

    // Hide the 'other college' input field if it exists
    const otherCollegeContainer = document.getElementById('other-college-container');
    if (otherCollegeContainer) {
        otherCollegeContainer.classList.add('hidden');
    }
}

// 🔐 HANDLE SIGNUP
async function handleSignup(event) {
    event.preventDefault();

    const collegeName = document.getElementById("signup-college").value;

    const fullName = document.getElementById("signup-fullname").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;
    const studentId = document.getElementById("signup-studentid").value.trim();
    const course = document.getElementById("signup-course").value.trim();
    const mobile = document.getElementById("signup-mobile").value.trim();
    const gender = document.getElementById("signup-gender").value;
    const termsChecked = document.getElementById("signup-terms").checked;

    if (!collegeName || !fullName || !email || !password || !studentId || !course || !mobile || !gender) {
        showMessage("Please fill all the fields.");
        return;
    }
    
    // Additional validation for the terms and conditions checkbox
    if (!termsChecked) {
        showMessage("You must agree to the Privacy Policy and Terms.");
        return;
    }

    setLoading(signupButton, true);
    showMessage("", false);

    try {
        // 🔥 1. Sign up the user in Supabase Auth
        const { data: authData, error: authError } = await sb.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    full_name: fullName,
                    college_name: collegeName,
                    student_id: studentId,
                    course: course,
                    mobile: mobile,
                    gender: gender
                }
            }
        });

        if (authError) {
            console.error("Signup error:", authError);
            showMessage(authError.message || "Failed to create account.");
            return;
        }

        const user = authData?.user;

       if (user) {
    showMessage("Account created successfully!", false);

    // Redirect immediately
    window.location.href = "../index.html";
} else {
    showMessage("Something went wrong during signup.");
}

    } catch (err) {
        console.error("Signup process error:", err);
        showMessage("An unexpected error occurred.");
    } finally {
        setLoading(signupButton, false);
    }
}

// 🔁 Check existing session
async function checkUserSession() {
    try {
        const { data } = await sb.auth.getSession();

        if (data?.session) {
            // already logged in → skip signup page
            window.location.href = "../index.html";
        }
    } catch (err) {
        console.error("Session check error:", err);
    }
}

// 🚀 INIT
document.addEventListener("DOMContentLoaded", () => {
    signupForm = document.getElementById("signup-form");
    signupButton = document.getElementById("signup-button");
    authMessage = document.getElementById("auth-message");

    if (!signupForm) {
        console.error("Signup form not found!");
        return;
    }

    // Load the dropdown list
    loadColleges();

    signupForm.addEventListener("submit", handleSignup);

    // check if already logged in
    checkUserSession();
});

// ========================================================
// CUSTOM COURSE PICKER ENGINE (SIGNUP)
// ========================================================
window.openSignupCoursePicker = function() {
    const picker = document.getElementById('modal-signup-course-picker');
    if (picker) {
        picker.classList.replace('hidden', 'flex');
        // Hide keyboard if it is open
        document.activeElement.blur();
    }
};

window.closeSignupCoursePicker = function() {
    const picker = document.getElementById('modal-signup-course-picker');
    if (picker) picker.classList.replace('flex', 'hidden');
};

window.selectSignupCourse = function(courseName) {
    // 1. Set the input value
    const input = document.getElementById('signup-course');
    if (input) input.value = courseName;
    
    // 2. Close the modal
    closeSignupCoursePicker();
};
// ========================================================
// CUSTOM GENDER PICKER ENGINE (SIGNUP)
// ========================================================
window.openSignupGenderPicker = function() {
    const picker = document.getElementById('modal-signup-gender-picker');
    if (picker) {
        picker.classList.replace('hidden', 'flex');
        // Hide keyboard if it is open
        document.activeElement.blur();
    }
};

window.closeSignupGenderPicker = function() {
    const picker = document.getElementById('modal-signup-gender-picker');
    if (picker) picker.classList.replace('flex', 'hidden');
};

window.selectSignupGender = function(gender) {
    // 1. Set the input value
    const input = document.getElementById('signup-gender');
    if (input) input.value = gender;
    
    // 2. Close the modal
    closeSignupGenderPicker();
};
