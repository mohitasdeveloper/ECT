export const CLOUDINARY_CLOUD_NAME = 'dnia8lb2q';
export const CLOUDINARY_UPLOAD_PRESET = 'EcoBirla_avatars';
export const CLOUDINARY_API_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;

export const TICK_IMAGES = {
    blue: 'https://i.ibb.co/kgJpMCHr/blue.png',
    silver: 'https://i.ibb.co/gLJLF9Z2/silver.png',
    gold: 'https://i.ibb.co/Q2C7MrM/gold.png',
    black: 'https://i.ibb.co/zVNSNzrK/black.png',
    green: 'https://i.ibb.co/SXGL4Nq0/green.png'
};

export let state = {
    currentUser: null, 
    userAuth: null,    
    checkInReward: 10,
    leaderboard: [],
    departmentLeaderboard: [],
    stores: [],
    products: [],      
    history: [],
    dailyChallenges: [],
    events: [],
    userRewards: [],   
    // ✅ UPDATED: Levels to match your screenshot
    levels: [
        { level: 1, title: 'Green Starter', minPoints: 0, nextMin: 1001, desc: "Just beginning your eco-journey. Every point counts!" },
        { level: 2, title: 'Eco Learner', minPoints: 1001, nextMin: 2001, desc: "You're building green habits. Keep up the momentum!" },
        { level: 3, title: 'Sustainability Leader', minPoints: 2001, nextMin: 4001, desc: "A true inspiration! You're making a real impact on campus." },
        { level: 4, title: 'Planet Protector', minPoints: 4001, nextMin: Infinity, desc: "You've reached the pinnacle of green leadership. Amazing!" }
    ],
    currentUploadChallengeId: null 
};
