/**
 * Netlify Function: verify-otp
 * Verifies submitted 6-digit OTP with bcrypt, activates user profile, and returns signed JWT
 * Resilient to Supabase schema cache status
 */

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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  try {
    const { email, otp } = JSON.parse(event.body || '{}');

    if (!email || !otp) {
      return jsonResponse(400, { error: 'Email and 6-digit verification code are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.toString().trim();

    if (cleanOtp.length !== 6) {
      return jsonResponse(400, { error: 'Verification code must be 6 digits.' });
    }

    let activeOtpRecord = null;
    let usingSupabase = isRealSupabaseConfigured && Boolean(supabase);

    if (usingSupabase) {
      try {
        const { data, error } = await supabase
          .from('otp_codes')
          .select('*')
          .eq('email', cleanEmail)
          .eq('consumed', false)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error && isTableMissingError(error)) {
          usingSupabase = false;
        } else if (data) {
          activeOtpRecord = data;
        }
      } catch (e) {
        usingSupabase = false;
      }
    }

    if (!usingSupabase || !activeOtpRecord) {
      activeOtpRecord = devStore.otp_codes
        .filter(o => o.email === cleanEmail && !o.consumed)
        .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
    }

    if (!activeOtpRecord) {
      return jsonResponse(400, { error: 'No active verification code found. Please request a new one.' });
    }

    // 1. Check lockout (max 5 attempts)
    if (activeOtpRecord.attempts >= 5) {
      return jsonResponse(429, { error: 'Too many incorrect attempts. This code has been locked. Please request a new code.' });
    }

    // 2. Check expiration (10 minutes)
    if (new Date(activeOtpRecord.expires_at) < new Date()) {
      return jsonResponse(400, { error: 'This verification code has expired. Please request a new one.' });
    }

    // 3. Constant-time comparison with bcrypt
    const isMatch = await bcrypt.compare(cleanOtp, activeOtpRecord.otp_hash);

    if (!isMatch) {
      const newAttempts = (activeOtpRecord.attempts || 0) + 1;
      const remainingAttempts = 5 - newAttempts;

      if (usingSupabase && activeOtpRecord.id) {
        try {
          await supabase
            .from('otp_codes')
            .update({ attempts: newAttempts })
            .eq('id', activeOtpRecord.id);
        } catch (e) {}
      } else {
        activeOtpRecord.attempts = newAttempts;
        saveDevStore();
      }

      if (remainingAttempts <= 0) {
        return jsonResponse(400, { error: 'Incorrect code. Maximum attempts reached. Please request a new code.' });
      }

      return jsonResponse(400, { 
        error: `Incorrect verification code. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.` 
      });
    }

    // Mark OTP consumed
    if (usingSupabase && activeOtpRecord.id) {
      try {
        await supabase
          .from('otp_codes')
          .update({ consumed: true })
          .eq('id', activeOtpRecord.id);

        // Activate profile
        const { data: userProfile, error: profileErr } = await supabase
          .from('profiles')
          .update({ email_verified: true })
          .eq('email', cleanEmail)
          .select('id, full_name, email, created_at')
          .single();

        if (profileErr) throw profileErr;

        const token = jwt.sign(
          { userId: userProfile.id, email: userProfile.email, name: userProfile.full_name },
          SESSION_SECRET,
          { expiresIn: '7d' }
        );

        return jsonResponse(200, {
          success: true,
          message: 'Account verified successfully.',
          token,
          user: userProfile
        });
      } catch (err) {
        if (!isTableMissingError(err)) {
          return jsonResponse(500, { error: 'Failed to update user profile in database.' });
        }
        usingSupabase = false;
      }
    }

    // Fallback store update
    activeOtpRecord.consumed = true;
    let profile = devStore.profiles.find(p => p.email === cleanEmail);
    if (profile) {
      profile.email_verified = true;
    } else {
      profile = {
        id: crypto.randomUUID(),
        email: cleanEmail,
        full_name: 'SecureShare User',
        email_verified: true,
        created_at: new Date().toISOString()
      };
      devStore.profiles.push(profile);
    }
    saveDevStore();

    const token = jwt.sign(
      { userId: profile.id, email: profile.email, name: profile.full_name },
      SESSION_SECRET,
      { expiresIn: '7d' }
    );

    return jsonResponse(200, {
      success: true,
      message: 'Account verified successfully.',
      token,
      user: { id: profile.id, full_name: profile.full_name, email: profile.email }
    });
  } catch (error) {
    console.error('[verify-otp] Unexpected error:', error);
    return jsonResponse(500, { error: 'Verification failed. Please try again.' });
  }
};
