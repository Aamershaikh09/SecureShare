/**
 * Netlify Function: list-shares
 * Lists active and revoked shares created by the authenticated user
 * Resilient to Supabase schema cache status
 */

const jwt = require('jsonwebtoken');
const { supabase, isRealSupabaseConfigured, isTableMissingError, devStore } = require('./_supabase');

const SESSION_SECRET = process.env.SESSION_SECRET || 'secureshare-super-secret-jwt-key-change-in-production-2026';

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
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
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method Not Allowed' });

  try {
    const authUser = verifyUserToken(event.headers.authorization || event.headers.Authorization);
    if (!authUser) {
      return jsonResponse(401, { error: 'Unauthorized: Session invalid.' });
    }

    let shares = [];
    let usingSupabase = isRealSupabaseConfigured && Boolean(supabase);

    if (usingSupabase) {
      try {
        const { data, error } = await supabase
          .from('shares')
          .select('*, files(*)')
          .eq('user_id', authUser.userId)
          .order('created_at', { ascending: false });

        if (error) {
          if (!isTableMissingError(error)) {
            console.error('[list-shares] DB error:', error);
            return jsonResponse(500, { error: 'Failed to retrieve shares: ' + error.message });
          }
          usingSupabase = false;
        } else {
          shares = (data || []).map(s => ({
            id: s.id,
            file_id: s.file_id,
            file_name: s.files ? s.files.file_name : 'Unknown File',
            file_size: s.files ? s.files.file_size : 0,
            file_type: s.files ? s.files.file_type : '',
            share_token: s.share_token,
            share_path: `/share/${s.share_token}`,
            has_password: Boolean(s.password_hash),
            expires_at: s.expires_at,
            is_revoked: s.is_revoked,
            download_count: s.download_count || 0,
            max_downloads: s.max_downloads,
            created_at: s.created_at
          }));
        }
      } catch (e) {
        usingSupabase = false;
      }
    }

    if (!usingSupabase) {
      shares = devStore.shares
        .filter(s => s.user_id === authUser.userId)
        .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
        .map(s => {
          const file = devStore.files.find(f => f.id === s.file_id);
          return {
            id: s.id,
            file_id: s.file_id,
            file_name: file ? file.file_name : 'Unknown File',
            file_size: file ? file.file_size : 0,
            file_type: file ? file.file_type : '',
            share_token: s.share_token,
            share_path: `/share/${s.share_token}`,
            has_password: Boolean(s.password_hash),
            expires_at: s.expires_at,
            is_revoked: s.is_revoked,
            download_count: s.download_count || 0,
            max_downloads: s.max_downloads,
            created_at: s.created_at
          };
        });
    }

    return jsonResponse(200, {
      success: true,
      shares
    });
  } catch (error) {
    console.error('[list-shares] Error:', error);
    return jsonResponse(500, { error: 'Internal error fetching shares.' });
  }
};
