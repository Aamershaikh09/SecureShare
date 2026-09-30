/**
 * Netlify Function: create-share
 * Generates an encrypted/tokenized share link with optional password & expiry
 * Resilient to Supabase schema cache status
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase, isRealSupabaseConfigured, isTableMissingError, devStore, saveDevStore } = require('./_supabase');

const SESSION_SECRET = process.env.SESSION_SECRET || 'secureshare-super-secret-jwt-key-change-in-production-2026';

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(data)
  };
}

function verifyUserToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    return jwt.verify(token, SESSION_SECRET);
  } catch (err) {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  try {
    const authUser = verifyUserToken(event.headers.authorization || event.headers.Authorization);
    if (!authUser) {
      return jsonResponse(401, { error: 'Unauthorized: Valid session required.' });
    }

    const { file_id, password, expires_in, max_downloads } = JSON.parse(event.body || '{}');

    if (!file_id) {
      return jsonResponse(400, { error: 'File ID is required to create a share link.' });
    }

    // Calculate expiration timestamp
    let expiresAtDate;
    const now = Date.now();
    if (expires_in === '1h') {
      expiresAtDate = new Date(now + 60 * 60 * 1000);
    } else if (expires_in === '24h') {
      expiresAtDate = new Date(now + 24 * 60 * 60 * 1000);
    } else if (expires_in === '7d') {
      expiresAtDate = new Date(now + 7 * 24 * 60 * 60 * 1000);
    } else if (expires_in === '30d') {
      expiresAtDate = new Date(now + 30 * 24 * 60 * 60 * 1000);
    } else if (expires_in && !isNaN(Date.parse(expires_in))) {
      expiresAtDate = new Date(expires_in);
    } else {
      expiresAtDate = new Date(now + 24 * 60 * 60 * 1000);
    }

    // Optional password hash
    let passwordHash = null;
    if (password && password.trim().length > 0) {
      passwordHash = await bcrypt.hash(password.trim(), 10);
    }

    const shareToken = crypto.randomUUID();
    const maxDl = max_downloads ? parseInt(max_downloads, 10) : null;
    let shareResult = null;
    let usingSupabase = isRealSupabaseConfigured && Boolean(supabase);

    if (usingSupabase) {
      try {
        const { data: fileData, error: fileErr } = await supabase
          .from('files')
          .select('id, file_name')
          .eq('id', file_id)
          .eq('user_id', authUser.userId)
          .maybeSingle();

        if (fileErr && isTableMissingError(fileErr)) {
          usingSupabase = false;
        } else if (fileData) {
          const { data: shareRow, error: shareErr } = await supabase
            .from('shares')
            .insert({
              file_id,
              user_id: authUser.userId,
              share_token: shareToken,
              password_hash: passwordHash,
              expires_at: expiresAtDate.toISOString(),
              is_revoked: false,
              download_count: 0,
              max_downloads: maxDl
            })
            .select()
            .single();

          if (shareErr) {
            if (isTableMissingError(shareErr)) {
              usingSupabase = false;
            } else {
              console.error('[create-share] DB error:', shareErr);
              return jsonResponse(500, { error: 'Could not create share link: ' + shareErr.message });
            }
          } else {
            shareResult = {
              id: shareRow.id,
              share_token: shareToken,
              share_path: `/share/${shareToken}`,
              expires_at: expiresAtDate.toISOString(),
              has_password: Boolean(passwordHash),
              max_downloads: maxDl,
              file_name: fileData.file_name
            };
          }
        }
      } catch (e) {
        usingSupabase = false;
      }
    }

    if (!shareResult) {
      const fileData = devStore.files.find(f => f.id === file_id);
      const fileName = fileData ? fileData.file_name : 'vault_file';

      const newShare = {
        id: crypto.randomUUID(),
        file_id,
        user_id: authUser.userId,
        share_token: shareToken,
        password_hash: passwordHash,
        expires_at: expiresAtDate.toISOString(),
        is_revoked: false,
        download_count: 0,
        max_downloads: maxDl,
        created_at: new Date().toISOString()
      };
      devStore.shares.push(newShare);
      saveDevStore();

      shareResult = {
        id: newShare.id,
        share_token: shareToken,
        share_path: `/share/${shareToken}`,
        expires_at: expiresAtDate.toISOString(),
        has_password: Boolean(passwordHash),
        max_downloads: maxDl,
        file_name: fileName
      };
    }

    return jsonResponse(201, {
      success: true,
      share: shareResult
    });
  } catch (error) {
    console.error('[create-share] Error:', error);
    return jsonResponse(500, { error: 'Failed to generate share link.' });
  }
};
