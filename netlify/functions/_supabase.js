/**
 * Supabase Server Client & Resilient Vault Handler
 * 
 * Features:
 * - Direct Supabase PostgreSQL + Storage connection with Service Role Key
 * - Automatic Table Availability Detection: If the user hasn't run sql/migration.sql
 *   in their Supabase Dashboard yet, the app gracefully falls back to persistent local storage
 *   instead of crashing with "PGRST205: Could not find the table in schema cache".
 * - Once migration.sql is executed, queries seamlessly flow to live Supabase PostgreSQL.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nlqdkbowymyrlotmpinh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'vault';

const isRealSupabaseConfigured = 
  Boolean(SUPABASE_SERVICE_ROLE_KEY) && 
  SUPABASE_SERVICE_ROLE_KEY.trim() !== '' && 
  !SUPABASE_SERVICE_ROLE_KEY.includes('<I will add');

let supabaseClient = null;

if (isRealSupabaseConfigured) {
  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    console.log('[SecureShare Backend] Supabase client initialized with Service Role Key.');
  } catch (err) {
    console.warn('[SecureShare Backend] Supabase init warning:', err.message);
  }
}

/**
 * Helper to identify if an error is due to a missing table in Supabase
 * (e.g. user hasn't run sql/migration.sql in their Supabase dashboard yet)
 */
function isTableMissingError(error) {
  if (!error) return false;
  const msg = error.message || '';
  const code = error.code || '';
  return code === 'PGRST205' || 
         code === '42P01' ||
         msg.includes('schema cache') || 
         msg.includes('Could not find the table') || 
         (msg.includes('relation') && msg.includes('does not exist'));
}

// Persistent Local Store (persists across requests & restarts during dev/fallback)
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
}
const storeFilePath = path.join(dataDir, 'dev_vault_store.json');

let devStore = {
  profiles: [],
  otp_codes: [],
  files: [],
  shares: []
};

// Load saved data if file exists
if (fs.existsSync(storeFilePath)) {
  try {
    const raw = fs.readFileSync(storeFilePath, 'utf8');
    devStore = JSON.parse(raw);
    if (!devStore.profiles) devStore.profiles = [];
    if (!devStore.otp_codes) devStore.otp_codes = [];
    if (!devStore.files) devStore.files = [];
    if (!devStore.shares) devStore.shares = [];
  } catch (e) {
    console.warn('[SecureShare Backend] Could not read dev_vault_store.json:', e.message);
  }
}

function saveDevStore() {
  try {
    fs.writeFileSync(storeFilePath, JSON.stringify(devStore, null, 2), 'utf8');
  } catch (e) {
    console.warn('[SecureShare Backend] Could not persist dev store to disk:', e.message);
  }
}

// In-memory binary storage map for mock files: path -> Buffer
const storageBuckets = new Map();

module.exports = {
  SUPABASE_URL,
  SUPABASE_STORAGE_BUCKET,
  isRealSupabaseConfigured,
  supabase: supabaseClient,
  isTableMissingError,
  devStore,
  saveDevStore,
  storageBuckets
};
