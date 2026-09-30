/**
 * Netlify Function: revoke-share
 * Revokes a share link, permanently disabling public access
 */

const jwt = require('jsonwebtoken');
const { supabase, isRealSupabaseConfigured, devStore } = require('./_supabase');

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
      return jsonResponse(401, { error: 'Unauthorized: Session invalid.' });
    }

    const { share_id, share_token } = JSON.parse(event.body || '{}');

    if (!share_id && !share_token) {
      return jsonResponse(400, { error: 'Share ID or token is required.' });
    }

    if (isRealSupabaseConfigured && supabase) {
      let query = supabase
        .from('shares')
        .update({ is_revoked: true })
        .eq('user_id', authUser.userId);

      if (share_id) {
        query = query.eq('id', share_id);
      } else {
        query = query.eq('share_token', share_token);
      }

      const { error } = await query;
      if (error) {
        return jsonResponse(500, { error: 'Failed to revoke link.' });
      }

      return jsonResponse(200, { success: true, message: 'Share link has been revoked.' });
    } else {
      const share = devStore.shares.find(s => 
        (s.id === share_id || s.share_token === share_token) && s.user_id === authUser.userId
      );
      if (share) {
        share.is_revoked = true;
      }
      return jsonResponse(200, { success: true, message: 'Share link has been revoked.' });
    }
  } catch (error) {
    console.error('[revoke-share] Error:', error);
    return jsonResponse(500, { error: 'Could not revoke share.' });
  }
};
