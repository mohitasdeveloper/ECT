// supabase.js

const SUPABASE_URL = "https://rreczghlcgsrcmfjpzdo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_TsYRWSpXaEnvopMDdzd36Q_N4TbMymz";

export const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);
