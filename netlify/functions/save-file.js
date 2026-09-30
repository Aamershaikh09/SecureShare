// netlify/functions/save-file.js
/**
 * Netlify Serverless Function: save-file
 * Endpoint: /.netlify/functions/save-file (or /api/upload via redirect)
 * 
 * Responsibilities:
 * 1. Restricts HTTP methods strictly to POST (405 for all others)
 * 2. Enforces 50MB maximum payload limit (returns HTTP 413 if exceeded)
 * 3. Validates required payload fields (fileName, fileSize, fileData)
 * 4. Uploads file buffer to Supabase Storage bucket "vault"
 * 5. Inserts file metadata record into the Supabase PostgreSQL "files" table
 * 6. Returns a uniform JSON response contract: { success: boolean, data?: any, error?: string }
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Environment & Configuration Constants
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nlqdkbowymyrlotmpinh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'vault';
const SESSION_SECRET = process.env.SESSION_SECRET || 'secureshare-super-secret-jwt-key-change-in-production-2026';
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB Limit

// Initialize Supabase Admin Client using Service Role Key
let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

/**
 * Standardized HTTP JSON response builder
 */
function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

/**
 * Extracts and verifies user from JWT Authorization header
 */
function extractAuthUser(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    return jwt.verify(token, SESSION_SECRET);
  } catch (err) {
    return null;
  }
}

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { success: true });
  }

  // 1. Strict HTTP Method enforcement
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, {
      success: false,
      error: `Method ${event.httpMethod} Not Allowed. Only POST requests are accepted.`
    });
  }

  // 2. Validate Supabase initialization
  if (!supabase) {
    return jsonResponse(500, {
      success: false,
      error: 'Supabase client is not configured. Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your environment variables.'
    });
  }

  try {
    // 3. Preliminary payload size check from request headers
    const contentLength = parseInt(event.headers['content-length'] || event.headers['Content-Length'] || '0', 10);
    if (contentLength > MAX_FILE_SIZE_BYTES * 1.4) {
      return jsonResponse(413, {
        success: false,
        error: 'Payload Too Large: File exceeds the maximum allowed limit of 50MB.'
      });
    }

    // 4. Parse incoming JSON body
    let payload = {};
    try {
      const rawBody = event.isBase64Encoded 
        ? Buffer.from(event.body, 'base64').toString('utf8') 
        : event.body;
      payload = JSON.parse(rawBody || '{}');
    } catch (parseError) {
      return jsonResponse(400, {
        success: false,
        error: 'Malformed JSON payload. Please send a valid JSON object.'
      });
    }

    const { fileName, fileSize, fileType, fileData, userId: customUserId } = payload;

    // 5. Validation: Required fields
    if (!fileName || !fileData) {
      return jsonResponse(400, {
        success: false,
        error: 'Missing required upload parameters: "fileName" and "fileData" are required.'
      });
    }

    const numericSize = parseInt(fileSize, 10) || 0;

    // 6. Validation: File size boundary check (50MB)
    if (numericSize > MAX_FILE_SIZE_BYTES) {
      return jsonResponse(413, {
        success: false,
        error: `File size (${(numericSize / (1024 * 1024)).toFixed(2)} MB) exceeds the 50 MB threshold.`
      });
    }

    // 7. Resolve authenticated user ID
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const authUser = extractAuthUser(authHeader);
    let userId = authUser ? authUser.userId : customUserId;

    if (!userId) {
      // Fallback: lookup existing profile in database to associate record
      const { data: existingProfile, error: profileErr } = await supabase
        .from('profiles')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (profileErr || !existingProfile) {
        return jsonResponse(401, {
          success: false,
          error: 'Unauthorized: User authentication required. Please sign in to upload files.'
        });
      }
      userId = existingProfile.id;
    }

    // 8. Prepare file buffer & storage path
    const buffer = Buffer.from(fileData, 'base64');
    const fileId = crypto.randomUUID();
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `${userId}/${timestamp}_${sanitizedFileName}`;

    // 9. Upload binary file buffer to Supabase Storage bucket "vault"
    const { data: storageUploadData, error: storageError } = await supabase
      .storage
      .from(STORAGE_BUCKET)
      .upload(storageKey, buffer, {
        contentType: fileType || 'application/octet-stream',
        upsert: false
      });

    if (storageError) {
      console.error('[save-file] Supabase Storage upload error:', storageError);
      return jsonResponse(500, {
        success: false,
        error: `Storage upload failed: ${storageError.message}`
      });
    }

    // 10. Insert file metadata record into the Supabase PostgreSQL "files" table
    const { data: fileRecord, error: dbError } = await supabase
      .from('files')
      .insert({
        id: fileId,
        user_id: userId,
        file_name: fileName,
        file_path: storageKey,
        file_size: numericSize || buffer.length,
        file_type: fileType || 'application/octet-stream'
      })
      .select()
      .single();

    if (dbError) {
      console.error('[save-file] Supabase Database insert error:', dbError);
      // Clean up uploaded file from storage if DB record creation fails
      await supabase.storage.from(STORAGE_BUCKET).remove([storageKey]);
      return jsonResponse(500, {
        success: false,
        error: `Database record creation failed: ${dbError.message}`
      });
    }

    // 11. Return standardized success response
    return jsonResponse(201, {
      success: true,
      data: fileRecord
    });

  } catch (error) {
    console.error('[save-file] Fatal processing error:', error);
    return jsonResponse(500, {
      success: false,
      error: error.message || 'Internal server error processing file upload.'
    });
  }
};
