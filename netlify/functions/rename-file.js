/**
 * Netlify Function: rename-file
 * Updates file display name in Postgres "files" table
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
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method Not Allowed' });

  try {
    const authUser = verifyUserToken(event.headers.authorization || event.headers.Authorization);
    if (!authUser) {
      return jsonResponse(401, { error: 'Unauthorized: Session invalid.' });
    }

    const { file_id, new_name } = JSON.parse(event.body || '{}');

    if (!file_id || !new_name || !new_name.trim()) {
      return jsonResponse(400, { error: 'file_id and new_name are required.' });
    }

    const cleanName = new_name.trim();

    if (isRealSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('files')
        .update({ file_name: cleanName })
        .eq('id', file_id)
        .eq('user_id', authUser.userId)
        .select()
        .single();

      if (error || !data) {
        return jsonResponse(404, { error: 'File not found or permission denied.' });
      }

      return jsonResponse(200, { success: true, file: data });
    } else {
      const file = devStore.files.find(f => f.id === file_id && f.user_id === authUser.userId);
      if (!file) {
        return jsonResponse(404, { error: 'File not found.' });
      }
      file.file_name = cleanName;
      return jsonResponse(200, { success: true, file });
    }
  } catch (error) {
    console.error('[rename-file] Error:', error);
    return jsonResponse(500, { error: 'Failed to rename file.' });
  }
};
