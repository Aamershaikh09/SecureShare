/**
 * Netlify Function: list-files
 * Fetches user's vault files from the Postgres "files" table + storage metrics
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

    let files = [];
    let usingSupabase = isRealSupabaseConfigured && Boolean(supabase);

    if (usingSupabase) {
      try {
        const { data, error } = await supabase
          .from('files')
          .select('*')
          .eq('user_id', authUser.userId)
          .order('created_at', { ascending: false });

        if (error) {
          if (!isTableMissingError(error)) {
            console.error('[list-files] DB error:', error);
            return jsonResponse(500, { error: 'Failed to retrieve files: ' + error.message });
          }
          usingSupabase = false;
        } else {
          files = data || [];
        }
      } catch (e) {
        usingSupabase = false;
      }
    }

    if (!usingSupabase) {
      files = devStore.files
        .filter(f => f.user_id === authUser.userId)
        .sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    }

    // Calculate aggregated storage
    let totalBytes = 0;
    let docsBytes = 0;
    let imageBytes = 0;
    let otherBytes = 0;

    files.forEach(f => {
      const size = Number(f.file_size) || 0;
      totalBytes += size;
      const type = (f.file_type || '').toLowerCase();
      if (type.includes('image')) {
        imageBytes += size;
      } else if (type.includes('pdf') || type.includes('doc') || type.includes('text') || type.includes('sheet') || type.includes('presentation')) {
        docsBytes += size;
      } else {
        otherBytes += size;
      }
    });

    return jsonResponse(200, {
      success: true,
      files,
      stats: {
        totalFiles: files.length,
        totalBytes,
        totalMb: (totalBytes / (1024 * 1024)).toFixed(2),
        docsBytes,
        imageBytes,
        otherBytes,
        maxStorageMb: 500
      }
    });
  } catch (error) {
    console.error('[list-files] Error:', error);
    return jsonResponse(500, { error: 'Internal error fetching files.' });
  }
};
