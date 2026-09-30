/**
 * Netlify Function: test-email
 * Diagnostic endpoint to test Gmail SMTP connectivity, environment variable presence,
 * and transport configuration from Netlify serverless functions.
 * 
 * Usage:
 *   GET /api/test-email?to=yourtest@gmail.com&DEBUG_KEY=<SESSION_SECRET>
 */

require('dotenv').config();
const { verifyTransport, sendMail, explainSmtpError, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_FROM } = require('./_mailer');

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    },
    body: JSON.stringify(data, null, 2)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method Not Allowed. Use GET /api/test-email' });
  }

  // Security Gate:
  // Only accessible in local development OR when caller supplies matching DEBUG_KEY = process.env.SESSION_SECRET
  const query = event.queryStringParameters || {};
  const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
  const sessionSecret = process.env.SESSION_SECRET || '';
  const debugKey = query.DEBUG_KEY || '';

  const isAuthorized = isDev || (Boolean(sessionSecret) && debugKey === sessionSecret);

  if (!isAuthorized) {
    return jsonResponse(401, {
      error: 'Unauthorized: The test-email diagnostic endpoint is protected in production.',
      hint: 'Provide query parameter: ?DEBUG_KEY=<your_SESSION_SECRET_value>'
    });
  }

  const recipient = query.to || SMTP_USER || '';

  // 1. Audit Environment Variables (boolean presence only, never expose secrets!)
  const envPresenceAudit = {
    SMTP_HOST: Boolean(process.env.SMTP_HOST),
    SMTP_PORT: Boolean(process.env.SMTP_PORT),
    SMTP_USER: Boolean(process.env.SMTP_USER),
    SMTP_PASSWORD: Boolean(process.env.SMTP_PASSWORD),
    SMTP_FROM: Boolean(process.env.SMTP_FROM),
    SESSION_SECRET: Boolean(process.env.SESSION_SECRET),
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_KEY: Boolean(process.env.SUPABASE_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    SUPABASE_STORAGE_BUCKET: Boolean(process.env.SUPABASE_STORAGE_BUCKET),
    NODE_ENV: process.env.NODE_ENV || 'development (fallback)'
  };

  // 2. Transport Configuration Details
  const transportConfig = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    requireTLS: true,
    family: 4, // Forced IPv4
    pool: true,
    connectionTimeoutMs: 10000,
    greetingTimeoutMs: 5000,
    socketTimeoutMs: 10000,
    configuredSender: SMTP_FROM,
    maskedUser: SMTP_USER ? SMTP_USER.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + '***' + c) : 'NOT_SET'
  };

  // 3. Test SMTP Handshake via verifyTransport()
  console.log('[test-email] Running SMTP handshake verification...');
  const verifyResult = await verifyTransport();

  // 4. Test Sending an actual email if requested or if recipient is available
  let sendResult = null;
  if (recipient && verifyResult.success) {
    console.log(`[test-email] Dispatching test email to ${recipient}...`);
    try {
      const result = await sendMail({
        to: recipient,
        subject: 'SecureShare SMTP Diagnostic: Test Succeeded ✅',
        text: 'Congratulations! Your SecureShare Gmail SMTP configuration on Netlify is fully operational (IPv4 forced, port 587, STARTTLS verified).',
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #E5E7EB; border-radius: 8px;">
            <h2 style="color: #10B981; margin-top: 0;">SMTP Test Succeeded ✅</h2>
            <p>Your SecureShare serverless mailer is operating properly.</p>
            <ul>
              <li><strong>Host:</strong> ${SMTP_HOST}:${SMTP_PORT}</li>
              <li><strong>Protocol:</strong> STARTTLS (requireTLS: true)</li>
              <li><strong>IP Protocol:</strong> Forced IPv4 (family: 4)</li>
              <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
            </ul>
          </div>
        `
      });
      sendResult = {
        success: true,
        messageId: result.messageId,
        recipient
      };
    } catch (sendErr) {
      sendResult = {
        success: false,
        error: sendErr.message,
        explanation: explainSmtpError(sendErr)
      };
    }
  } else if (!verifyResult.success) {
    sendResult = {
      success: false,
      skipped: 'Send skipped because SMTP verification failed.',
      reason: verifyResult.error
    };
  } else {
    sendResult = {
      skipped: 'Provide ?to=your_email@example.com in query to trigger live test message delivery.'
    };
  }

  const overallSuccess = verifyResult.success && (!sendResult || sendResult.success !== false);

  return jsonResponse(overallSuccess ? 200 : 500, {
    status: overallSuccess ? 'HEALTHY' : 'FAILED',
    timestamp: new Date().toISOString(),
    envPresenceAudit,
    transportConfig,
    verifyResult,
    sendResult,
    diagnostics: {
      ipv4Forced: true,
      troubleshooting: verifyResult.success 
        ? 'SMTP is operating properly.'
        : 'If SMTP_AUTH_FAILED: Generate a fresh 16-character Gmail App Password at myaccount.google.com/apppasswords. If SMTP_TIMEOUT: Ensure Netlify outbound traffic to port 587 is permitted and IPv4 family 4 is active.'
    }
  });
};
