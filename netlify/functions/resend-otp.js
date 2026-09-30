/**
 * Netlify Function: resend-otp
 * Resends a fresh 6-digit OTP with strict 30-second cooldown and 5/hr rate limits
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { supabase, isRealSupabaseConfigured, devStore } = require('./_supabase');
const { sendMail } = require('./_mailer');
const { getOtpEmailTemplate } = require('./_templates');

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
    const { email } = JSON.parse(event.body || '{}');

    if (!email) {
      return jsonResponse(400, { error: 'Email is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const thirtySecAgo = new Date(Date.now() - 30 * 1000).toISOString();

    let userName = 'User';

    if (isRealSupabaseConfigured && supabase) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (profile && profile.full_name) {
        userName = profile.full_name;
      }

      // Check rate limit: max 5 in past hour
      const { data: recentOtps } = await supabase
        .from('otp_codes')
        .select('created_at')
        .eq('email', cleanEmail)
        .gte('created_at', oneHourAgo);

      if (recentOtps && recentOtps.length >= 5) {
        return jsonResponse(429, { error: 'Rate limit reached: Max 5 OTPs per hour. Please wait a bit.' });
      }

      // Check cooldown: 30 seconds
      const { data: latestOtp } = await supabase
        .from('otp_codes')
        .select('created_at')
        .eq('email', cleanEmail)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestOtp && new Date(latestOtp.created_at) > new Date(thirtySecAgo)) {
        const secondsLeft = Math.ceil((new Date(latestOtp.created_at).getTime() + 30000 - Date.now()) / 1000);
        return jsonResponse(429, { error: `Please wait ${secondsLeft > 0 ? secondsLeft : 30} seconds before requesting a new code.` });
      }
    } else {
      const prof = devStore.profiles.find(p => p.email === cleanEmail);
      if (prof) userName = prof.full_name;

      const recent = devStore.otp_codes.filter(o => o.email === cleanEmail && new Date(o.created_at) >= new Date(oneHourAgo));
      if (recent.length >= 5) {
        return jsonResponse(429, { error: 'Rate limit reached: Max 5 OTPs per hour.' });
      }
      const latest = devStore.otp_codes.filter(o => o.email === cleanEmail).sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (latest && new Date(latest.created_at) > new Date(thirtySecAgo)) {
        return jsonResponse(429, { error: 'Please wait 30 seconds before requesting a new code.' });
      }
    }

    // Generate new OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otpCode, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    console.log(`\n======================================================`);
    console.log(`[SecureShare Dev Resend OTP] New code for ${cleanEmail}: ${otpCode}`);
    console.log(`======================================================\n`);

    if (isRealSupabaseConfigured && supabase) {
      // Mark old unconsumed codes as consumed
      await supabase
        .from('otp_codes')
        .update({ consumed: true })
        .eq('email', cleanEmail)
        .eq('consumed', false);

      await supabase.from('otp_codes').insert({
        email: cleanEmail,
        otp_hash: otpHash,
        expires_at: expiresAt,
        attempts: 0,
        consumed: false
      });
    } else {
      devStore.otp_codes.forEach(o => {
        if (o.email === cleanEmail) o.consumed = true;
      });
      devStore.otp_codes.push({
        id: crypto.randomUUID(),
        email: cleanEmail,
        otp_hash: otpHash,
        expires_at: expiresAt,
        attempts: 0,
        consumed: false,
        created_at: new Date().toISOString()
      });
    }

    // Send email
    const emailTemplate = getOtpEmailTemplate(otpCode, userName);
    try {
      await sendMail({
        to: cleanEmail,
        subject: `Your New SecureShare Verification Code: ${otpCode}`,
        html: emailTemplate.html,
        text: emailTemplate.text
      });
    } catch (e) {
      console.warn('[resend-otp] Mail error:', e.message);
    }

    return jsonResponse(200, {
      success: true,
      message: 'A fresh verification code has been dispatched to your email.'
    });
  } catch (error) {
    console.error('[resend-otp] Error:', error);
    return jsonResponse(500, { error: 'Could not resend code. Please try again.' });
  }
};
