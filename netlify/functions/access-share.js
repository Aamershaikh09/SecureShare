/**
 * Netlify Function: access-share
 * Public viewer & downloader for tokenized file shares (no authentication needed)
 */

const bcrypt = require('bcryptjs');
const { supabase, isRealSupabaseConfigured, devStore, SUPABASE_STORAGE_BUCKET } = require('./_supabase');

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    },
    body: JSON.stringify(data)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  try {
    let token = '';
    let password = '';
    let isDownloadAction = false;

    if (event.httpMethod === 'GET') {
      token = (event.queryStringParameters && event.queryStringParameters.token) || '';
      password = (event.queryStringParameters && event.queryStringParameters.password) || '';
      isDownloadAction = event.queryStringParameters && event.queryStringParameters.action === 'download';
    } else if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      token = body.token || '';
      password = body.password || '';
      isDownloadAction = body.action === 'download';
    }

    if (!token) {
      return jsonResponse(400, { error: 'Share token is required.' });
    }

    let shareRecord = null;
    let fileRecord = null;

    if (isRealSupabaseConfigured && supabase) {
      const { data: share, error: sErr } = await supabase
        .from('shares')
        .select('*, files(*)')
        .eq('share_token', token)
        .maybeSingle();

      if (sErr || !share) {
        return jsonResponse(404, { 
          status: 'not_found', 
          error: 'This file share does not exist or has been deleted.' 
        });
      }

      shareRecord = share;
      fileRecord = share.files;
    } else {
      shareRecord = devStore.shares.find(s => s.share_token === token);
      if (!shareRecord) {
        return jsonResponse(404, { 
          status: 'not_found', 
          error: 'This file share does not exist or has been deleted.' 
        });
      }
      fileRecord = devStore.files.find(f => f.id === shareRecord.file_id);
      if (!fileRecord) {
        return jsonResponse(404, { 
          status: 'not_found', 
          error: 'Underlying vault file has been removed.' 
        });
      }
    }

    // 1. Check if revoked
    if (shareRecord.is_revoked) {
      return jsonResponse(410, {
        status: 'revoked',
        error: 'This link has been revoked by the sender. Access is permanently closed.'
      });
    }

    // 2. Check if expired
    const isExpired = new Date(shareRecord.expires_at) < new Date();
    if (isExpired) {
      return jsonResponse(410, {
        status: 'expired',
        error: 'This share link has expired.'
      });
    }

    // 3. Check download limit
    if (shareRecord.max_downloads && shareRecord.download_count >= shareRecord.max_downloads) {
      return jsonResponse(403, {
        status: 'limit_reached',
        error: 'The maximum download limit for this link has been reached.'
      });
    }

    // 4. Password Protection Verification
    const hasPassword = Boolean(shareRecord.password_hash);
    if (hasPassword) {
      if (!password) {
        return jsonResponse(200, {
          status: 'password_required',
          requiresPassword: true,
          fileName: fileRecord.file_name,
          fileSize: fileRecord.file_size,
          fileType: fileRecord.file_type,
          expiresAt: shareRecord.expires_at
        });
      }

      const isMatch = await bcrypt.compare(password, shareRecord.password_hash);
      if (!isMatch) {
        return jsonResponse(401, {
          status: 'invalid_password',
          error: 'Incorrect password. Access denied.',
          requiresPassword: true
        });
      }
    }

    // If download action is requested:
    if (isDownloadAction) {
      let downloadUrl = '';

      if (isRealSupabaseConfigured && supabase) {
        // Increment download count
        await supabase
          .from('shares')
          .update({ download_count: (shareRecord.download_count || 0) + 1 })
          .eq('id', shareRecord.id);

        // Generate Supabase Storage Signed URL (1-hour expiry)
        const { data: signedData, error: signErr } = await supabase
          .storage
          .from(SUPABASE_STORAGE_BUCKET)
          .createSignedUrl(fileRecord.file_path, 3600, {
            download: fileRecord.file_name
          });

        if (signErr || !signedData) {
          console.error('[access-share] Signed URL error:', signErr);
          return jsonResponse(500, { error: 'Failed to generate download stream.' });
        }
        downloadUrl = signedData.signedUrl;
      } else {
        // DevStore mock
        shareRecord.download_count = (shareRecord.download_count || 0) + 1;
        downloadUrl = `/api/download-direct?file_id=${fileRecord.id}&token=${token}`;
      }

      return jsonResponse(200, {
        status: 'ready',
        downloadUrl,
        fileName: fileRecord.file_name,
        fileSize: fileRecord.file_size,
        fileType: fileRecord.file_type,
        downloadCount: (shareRecord.download_count || 0) + 1,
        maxDownloads: shareRecord.max_downloads
      });
    }

    // Default metadata view
    return jsonResponse(200, {
      status: 'accessible',
      fileName: fileRecord.file_name,
      fileSize: fileRecord.file_size,
      fileType: fileRecord.file_type,
      createdAt: fileRecord.created_at,
      expiresAt: shareRecord.expires_at,
      downloadCount: shareRecord.download_count || 0,
      maxDownloads: shareRecord.max_downloads,
      hasPassword
    });
  } catch (error) {
    console.error('[access-share] Error:', error);
    return jsonResponse(500, { error: 'Internal error accessing share.' });
  }
};
