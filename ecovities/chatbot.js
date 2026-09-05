import { supabase } from './supabase-client.js'; // Import Supabase
import { state } from './state.js';
import { els } from './utils.js';

// ==========================================
// ⚙️ CONFIGURATION
// ==========================================
// Update this if Supabase gives you a different URL
const EDGE_FUNCTION_URL = 'https://aggqmjxhnsbmsymwblqg.supabase.co/functions/v1/chat-ai'; 
// ^ REPLACE THIS with your actual Edge Function URL from Supabase Dashboard

// ==========================================
// 🧠 AI LOGIC (EcoBuddy's Brain)
// ==========================================

const getSystemPrompt = () => {
    const user = state.currentUser || { full_name: 'Eco-Warrior', current_points: 0, course: 'General' };

    // Format Live Data
    const activeEvents = state.events && state.events.length > 0 
        ? state.events.map(e => `• ${e.title} (${new Date(e.start_at).toLocaleDateString()})`).join('\n')
        : "No events right now.";
    
    const storeItems = state.products && state.products.length > 0
        ? state.products.slice(0, 5).map(p => `• ${p.name} (${p.ecopoints_cost} pts)`).join('\n')
        : "Store restocking.";

    const topRankers = state.leaderboard && state.leaderboard.length > 0
        ? state.leaderboard.slice(0, 3).map((u, i) => `${i+1}. ${u.full_name}`).join('\n')
        : "Loading...";
    
    return `
    You are **EcoBuddy**, the funny, friendly AI bestie for the **EcoCampus** App! 🌿😎
    
    **🆔 IDENTITY:**
    - **Creator:** Mr. Mohit Mali (SYBAF).
    - **Origin:** BKBNC Green Club Initiative.
    - **College:** B.K. Birla Night Arts, Science & Commerce College, Kalyan (**BKBNC**).
    
    **👤 USER:** ${user.full_name} (${user.current_points} Pts)
    
    **📊 LIVE DATA:**
    - **Events:** \n${activeEvents}
    - **Store:** \n${storeItems}
    - **Leaders:** \n${topRankers}
    
    **🗣️ VIBE:**
    - Speak like a cool college friend. Use slang, emojis, and humor.
    - If user speaks Hindi/Marathi/Hinglish, reply in that language!
    - Be helpful but keep it fun.
    `;
};

const fetchAIResponse = async (userMessage) => {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        // Call Supabase Edge Function
        const response = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token || ''}` // Optional: Pass auth token if you enable RLS on functions
            },
            body: JSON.stringify({ 
                message: userMessage,
                systemPrompt: getSystemPrompt() 
            })
        });

        const data = await response.json();
        
        if (!response.ok) throw new Error(data.error || "Server Error");
        return data.reply;

    } catch (error) {
        console.error("AI Fetch Error:", error);
        return "🔌 My brain is offline (Server Error). Try again later!";
    }
};

// ==========================================
// 💾 SUPABASE HISTORY LOGIC
// ==========================================

const saveMessageToDB = async (role, message) => {
    if (!state.currentUser) return;
    try {
        await supabase.from('chat_history').insert({
            user_id: state.currentUser.id,
            role: role,
            message: message
        });
    } catch (err) {
        console.error("Save Chat Error:", err);
    }
};

const loadChatHistory = async () => {
    if (!state.currentUser) return;
    
    const chatOutput = document.getElementById('chatbot-messages');
    chatOutput.innerHTML = `<div class="text-center py-6"><p class="text-xs text-gray-400 dark:text-gray-600">Messages are secured with end-to-end encryption.</p></div>`;

    try {
        const { data, error } = await supabase
            .from('chat_history')
            .select('*')
            .eq('user_id', state.currentUser.id)
            .order('created_at', { ascending: false }) 
            .limit(20); 

        if (error) throw error;

        if (data && data.length > 0) {
            data.reverse().forEach(msg => appendMessageUI(msg.message, msg.role, false)); 
            setTimeout(() => chatOutput.scrollTop = chatOutput.scrollHeight, 100);
        } else {
            appendMessageUI(`Hi ${state.currentUser.full_name}! I'm EcoBuddy. Ask me anything about BKBNC or saving the planet! 🌱`, 'bot');
        }
    } catch (err) {
        console.error("Load History Error:", err);
    }
};

// ==========================================
// 🎨 UI HANDLERS
// ==========================================

const chatOutput = document.getElementById('chatbot-messages');
const chatForm = document.getElementById('chatbot-form');
const chatInput = document.getElementById('chatbot-input');

// SEPARATED UI LOGIC
const appendMessageUI = (text, sender, animate = true) => {
    const div = document.createElement('div');
    div.className = `msg-group w-full flex ${sender === 'user' ? 'justify-end' : 'justify-start'} ${animate ? 'animate-slideUp' : ''}`;
    
    const parsedText = marked.parse(text);

    if (sender === 'user') {
        // User Bubble
        div.innerHTML = `
            <div class="max-w-[85%] p-4 px-5 rounded-[20px] rounded-br-lg text-white shadow-md bg-gradient-to-br from-[#34c46e] to-[#169653]">
                <div class="text-sm leading-relaxed">${parsedText}</div>
            </div>`;
    } else {
        // Bot Bubble WITH EARTH LOGO
        div.innerHTML = `
            <div class="flex items-end gap-2 max-w-[90%]">
                <div class="w-8 h-8 rounded-full bg-white p-0.5 shadow-sm flex-shrink-0 border border-[#c8ffe1]">
                    <img src="https://i.ibb.co/7xwsMnBc/Pngtree-green-earth-globe-clip-art-16672659-1.png" class="w-full h-full object-contain rounded-full">
                </div>
                <div class="p-4 px-5 rounded-[20px] rounded-bl-lg border border-[#c8ffe1]/75 dark:border-white/10 bg-white/85 dark:bg-[#1e3c2d]/70 text-[#2c4434] dark:text-[#e7ffef]">
                    <div class="text-sm leading-relaxed">${parsedText}</div>
                </div>
            </div>`;
    }
    
    const chatOutput = document.getElementById('chatbot-messages');
    if (chatOutput) {
        chatOutput.appendChild(div);
        chatOutput.scrollTop = chatOutput.scrollHeight; 
    }
};

if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (!message) return;

        // 1. UI: Show User Message
        appendMessageUI(message, 'user');
        chatInput.value = '';
        
        // 2. DB: Save User Message
        saveMessageToDB('user', message);

        // 3. UI: Show Typing
        const typingId = 'typing-' + Date.now();
        const typingDiv = document.createElement('div');
        typingDiv.id = typingId;
        typingDiv.className = 'msg-group w-full flex justify-start animate-slideUp';
        typingDiv.innerHTML = `
            <div class="flex items-end gap-2 max-w-[90%]">
                <div class="w-8 h-8 rounded-full bg-white p-0.5 shadow-sm flex-shrink-0 border border-[#c8ffe1]">
                    <img src="https://i.ibb.co/7xwsMnBc/Pngtree-green-earth-globe-clip-art-16672659-1.png" class="w-full h-full object-contain rounded-full">
                </div>
                <div class="p-4 px-5 rounded-[20px] rounded-bl-lg border border-[#c8ffe1]/75 dark:border-white/10 bg-white/85 dark:bg-[#1e3c2d]/70 flex items-center gap-1 h-[54px]">
                     <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
                </div>
            </div>`;
        
        chatOutput.appendChild(typingDiv);
        chatOutput.scrollTop = chatOutput.scrollHeight;

        // 4. API: Fetch Response (Via Edge Function)
        const botResponse = await fetchAIResponse(message);

        // 5. UI: Remove Typing & Show Response
        const typingEl = document.getElementById(typingId);
        if(typingEl) typingEl.remove();
        appendMessageUI(botResponse, 'bot');

        // 6. DB: Save Bot Response
        saveMessageToDB('bot', botResponse);
    });
}

// ==========================================
// 🚪 MODAL LOGIC
// ==========================================

window.openChatbotModal = () => {
    const modal = document.getElementById('chatbot-modal');
    modal.classList.remove('invisible'); 
    requestAnimationFrame(() => {
        modal.classList.remove('translate-y-full');
    });
    loadChatHistory();
};

window.closeChatbotModal = () => {
    const modal = document.getElementById('chatbot-modal');
    modal.classList.add('translate-y-full');
    setTimeout(() => {
        modal.classList.add('invisible');
    }, 500);
};

// ==========================================
// 📝 MARKDOWN PARSER
// ==========================================
const marked = {
    parse: (text) => {
        if(!text) return '';
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); 
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>'); 
        text = text.replace(/^- (.*$)/gim, '<li>$1</li>'); 
        text = text.replace(/\n/g, '<br>'); 
        return text;
    }
};
