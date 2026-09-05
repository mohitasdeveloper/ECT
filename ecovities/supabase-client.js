import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 🟢 YOUR ECOVITIES DATABASE PROJECT CREDENTIALS
// This project holds the specific schema, points, events, and logic for EcoCampus.
const DB_URL = "https://osvwwlpdmluvtbyhsdfc.supabase.co";
const DB_KEY = "sb_publishable_wf7P1OBiLu8KIMRuDCN23Q_iAadvaSi";

export const supabase = createClient(DB_URL, DB_KEY);
