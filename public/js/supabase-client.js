/**
 * SecureShare Supabase Client (Frontend Anon/Publishable Key ONLY)
 * 
 * SECURITY RULE:
 * Never include the SUPABASE_SERVICE_ROLE_KEY here.
 * The publishable key is safe for public client usage with RLS policies enabled.
 */

const SUPABASE_CONFIG = {
  url: "https://nlqdkbowymyrlotmpinh.supabase.co",
  anonKey: "sb_publishable_dfYKnruS31FXXcGdJgOw2w_3K0HDgmo",
  bucketName: "vault"
};

// Initialize Supabase if the official CDN script is loaded
let supabaseClient = null;

if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    console.log('[SecureShare Client] Supabase client initialized with publishable key.');
  } catch (err) {
    console.warn('[SecureShare Client] Could not initialize Supabase browser client:', err);
  }
}

window.SECURESHARE_CONFIG = SUPABASE_CONFIG;
window.supabaseClient = supabaseClient;
