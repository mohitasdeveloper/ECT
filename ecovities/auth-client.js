import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const AUTH_URL = "https://rreczghlcgsrcmfjpzdo.supabase.co";
const AUTH_KEY = "sb_publishable_TsYRWSpXaEnvopMDdzd36Q_N4TbMymz";

export const authClient = createClient(AUTH_URL, AUTH_KEY);
