/**
 * Netlify Function: delete-file
 * Removes binary file from Supabase Storage "vault" AND metadata from "files" table
 */

const jwt = require('jsonwebtoken');
const { supabase, isRealSupabaseConfigured, devStore, SUPABASE_STORAGE_BUCKET } = require('./_supabase');

const SESSION_SECRET = process.env.SESSION_SECRET || 'secureshare-super-secret-jwt-key-change-in-production-2026';

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS'
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
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'DELETE') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  try {
    const authUser = verifyUserToken(event.headers.authorization || event.headers.Authorization);
    if (!authUser) {
      return jsonResponse(401, { error: 'Unauthorized: Session invalid.' });
    }

    const { file_id } = JSON.parse(event.body || '{}');
    if (!file_id) {
      return jsonResponse(400, { error: 'file_id is required.' });
    }

    if (isRealSupabaseConfigured && supabase) {
      // 1. Get file path
      const { data: file, error: fetchErr } = await supabase
        .from('files')
        .select('id, file_path')
        .eq('id', file_id)
        .eq('user_id', authUser.userId)
        .single();

      if (fetchErr || !file) {
        return jsonResponse(404, { error: 'File not found or access denied.' });
      }

      // 2. Remove from Supabase Storage bucket
      if (file.file_path) {
        const { error: storageErr } = await supabase
          .storage
          .from(SUPABASE_STORAGE_BUCKET)
          .remove([file.file_path]);

        if (storageErr) {
          console.warn('[delete-file] Storage delete notice:', storageErr.message);
        }
      }

      // 3. Remove metadata from "files" table (cascades to shares)
      const { error: dbErr } = await supabase
        .from('files')
        .delete()
        .eq('id', file_id);

      if (dbErr) {
        console.error('[delete-file] DB delete error:', dbErr);
        return jsonResponse(500, { error: 'Could not delete database record.' });
      }

      return jsonResponse(200, { success: true, message: 'File deleted from vault and storage.' });
    } else {
      const idx = devStore.files.findIndex(f => f.id === file_id && f.user_id === authUser.userId);
      if (idx === -1) {
        return jsonResponse(404, { error: 'File not found.' });
      }
      devStore.files.splice(idx, 1);
      // Clean up shares
      devStore.shares = devStore.shares.filter(s => s.file_id !== file_id);
      return jsonResponse(200, { success: true, message: 'File deleted from vault.' });
    }
  } catch (error) {
    console.error('[delete-file] Error:', error);
    return jsonResponse(500, { error: 'Failed to delete file.' });
  }
};
