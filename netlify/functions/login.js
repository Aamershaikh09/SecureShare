/**
 * Netlify Function: login
 * Authenticates user credentials with bcrypt and returns signed JWT
 * Resilient to Supabase schema cache status
 */

const bcrypt = require('bcryptjs');
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(data)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  try {
    const { email, password } = JSON.parse(event.body || '{}');

    if (!email || !password) {
      return jsonResponse(400, { error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    let user = null;
    let usingSupabase = isRealSupabaseConfigured && Boolean(supabase);

    if (usingSupabase) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', cleanEmail)
          .maybeSingle();

        if (error && isTableMissingError(error)) {
          usingSupabase = false;
        } else if (data) {
          user = data;
        }
      } catch (e) {
        usingSupabase = false;
      }
    }

    if (!user) {
      user = devStore.profiles.find(p => p.email === cleanEmail);
    }

    if (!user) {
      // Generic error message to prevent email enumeration
      return jsonResponse(401, { error: 'Invalid email or password.' });
    }

    // Verify password with bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return jsonResponse(401, { error: 'Invalid email or password.' });
    }

    // Check if email has been verified
    if (!user.email_verified) {
      return jsonResponse(403, { 
        error: 'Please verify your email address before logging in.',
        needsVerification: true,
        email: cleanEmail
      });
    }

    // Issue JWT (HS256, 7-day expiry)
    const token = jwt.sign(
      { userId: user.id, email: user.email, name: user.full_name },
      SESSION_SECRET,
      { expiresIn: '7d' }
    );

    return jsonResponse(200, {
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('[login] Error:', error);
    return jsonResponse(500, { error: 'Internal login error. Please try again.' });
  }
};
