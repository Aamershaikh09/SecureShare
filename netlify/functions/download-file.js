/**
 * Netlify Function: download-file
 * Generates an ephemeral Supabase signed URL (1-hour validity) for vault owner download
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

    const file_id = event.queryStringParameters && event.queryStringParameters.file_id;
    if (!file_id) {
      return jsonResponse(400, { error: 'file_id query parameter is required.' });
    }

    if (isRealSupabaseConfigured && supabase) {
      const { data: file, error: fetchErr } = await supabase
        .from('files')
        .select('*')
        .eq('id', file_id)
        .eq('user_id', authUser.userId)
        .single();

      if (fetchErr || !file) {
        return jsonResponse(404, { error: 'File not found or access denied.' });
      }

      // Generate 1-hour signed URL from private bucket "vault"
      const { data: signedData, error: signErr } = await supabase
        .storage
        .from(SUPABASE_STORAGE_BUCKET)
        .createSignedUrl(file.file_path, 3600, {
          download: file.file_name
        });

      if (signErr || !signedData) {
        console.error('[download-file] Supabase signed URL error:', signErr);
        return jsonResponse(500, { error: 'Could not generate signed download URL.' });
      }

      return jsonResponse(200, {
        success: true,
        downloadUrl: signedData.signedUrl,
        fileName: file.file_name
      });
    } else {
      const file = devStore.files.find(f => f.id === file_id && f.user_id === authUser.userId);
      if (!file) {
        return jsonResponse(404, { error: 'File not found.' });
      }

      return jsonResponse(200, {
        success: true,
        downloadUrl: `/api/download-direct?file_id=${file.id}`,
        fileName: file.file_name
      });
    }
  } catch (error) {
    console.error('[download-file] Error:', error);
    return jsonResponse(500, { error: 'Failed to prepare download.' });
  }
};
