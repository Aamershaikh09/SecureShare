/**
 * SecureShare Nodemailer Transport Configuration
 * 
 * Optimized for Serverless & Netlify Functions:
 * 1. Force IPv4 (family: 4) to avoid Netlify IPv6 route drops
 * 2. Explicit connection/greeting/socket timeouts to avoid 10s Netlify function kill
 * 3. Connection pooling (pool: true) for efficient connection reuse
 * 4. Human-readable error diagnostic logging for SMTP error codes
 */

const nodemailer = require('nodemailer');
require('dotenv').config();

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
// Strip accidental whitespace or quotes if user copied app password with spaces
const SMTP_PASSWORD = (process.env.SMTP_PASSWORD || '').replace(/\s+/g, '');
const SMTP_FROM = process.env.SMTP_FROM || `SecureShare <${SMTP_USER || 'noreply@secureshare.local'}>`;

console.log('[SecureShare Mailer] Stage: Creating transport (IPv4 forced, port: 587, pool: true)');

// Initialize reusable transporter with pooling, explicit timeouts, and IPv4
const transporter = nodemailer.createTransport({
  pool: true,
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false, // false for port 587 (STARTTLS)
  requireTLS: true,
  family: 4, // CRITICAL: Force IPv4. Prevents Netlify from hanging on Gmail IPv6 addresses!
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASSWORD
  },
  connectionTimeout: 10000, // 10s connection timeout
  greetingTimeout: 5000,    // 5s server greeting timeout
  socketTimeout: 10000,     // 10s socket inactivity timeout
  tls: {
    rejectUnauthorized: false
  }
});

/**
 * Maps common Nodemailer / SMTP errors to actionable human-readable explanations
 */
function explainSmtpError(error) {
  if (!error) return 'Unknown error occurred.';

  const code = error.code || '';
  const response = error.response || '';
  const message = error.message || '';

  if (code === 'EAUTH' || response.includes('535') || message.includes('Username and Password not accepted')) {
    return 'SMTP_AUTH_FAILED: Gmail App Password invalid, expired, or 2-Step Verification is not enabled on this Google account. Note: You must generate a 16-character App Password from myaccount.google.com/apppasswords; standard Google account passwords are rejected.';
  }

  if (code === 'ETIMEDOUT' || message.includes('timed out')) {
    return 'SMTP_TIMEOUT: Connection timed out. Netlify outbound traffic to port 587 may be blocked or dropped. Ensure IPv4 (family: 4) is forced.';
  }

  if (code === 'ECONNREFUSED') {
    return 'SMTP_CONNECTION_REFUSED: Destination host rejected connection. Verify SMTP_HOST (smtp.gmail.com) and SMTP_PORT (587).';
  }

  if (code === 'ESOCKET') {
    return 'ESOCKET: Socket error encountered during TLS handshake or stream transmission.';
  }

  return `${code || 'SMTP_ERROR'}: ${message} ${response ? `(${response})` : ''}`;
}

/**
 * Verify transporter connection on startup or diagnostic checks
 */
async function verifyTransport() {
  if (!SMTP_USER || !SMTP_PASSWORD) {
    console.warn('[SecureShare Mailer] Warning: SMTP_USER or SMTP_PASSWORD is not set in environment.');
    return { 
      success: false, 
      error: 'SMTP credentials missing from environment variables (SMTP_USER or SMTP_PASSWORD empty).' 
    };
  }

  console.log('[SecureShare Mailer] Stage: Verifying SMTP connection to ' + SMTP_HOST + ':' + SMTP_PORT + ' (IPv4)...');

  try {
    await transporter.verify();
    console.log('[SecureShare Mailer] Stage: SMTP verified OK - Gmail connection active and authorized.');
    return { success: true };
  } catch (error) {
    const explanation = explainSmtpError(error);
    console.error('[SecureShare Mailer] SMTP verification failed:\n-> ' + explanation);
    return { 
      success: false, 
      error: explanation, 
      rawCode: error.code, 
      rawMessage: error.message 
    };
  }
}

/**
 * Send an email safely with structured logging at each stage
 */
async function sendMail({ to, subject, html, text }) {
  const maskedTo = to ? to.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.min(b.length, 5)) + c) : 'unknown';

  if (!SMTP_USER || !SMTP_PASSWORD) {
    console.warn(`[SecureShare Mailer] [NO SMTP CONFIG] Cannot send email to ${maskedTo}. SMTP_USER or SMTP_PASSWORD missing.`);
    throw new Error('SMTP_CREDENTIALS_MISSING: SMTP_USER or SMTP_PASSWORD is not configured in Netlify environment variables.');
  }

  console.log(`[SecureShare Mailer] Stage: Sending mail to ${maskedTo} [Subject: "${subject}"]`);

  const mailOptions = {
    from: SMTP_FROM,
    to,
    subject,
    text,
    html
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[SecureShare Mailer] Stage: Mail sent OK (MessageId: ${info.messageId})`);
    return { success: true, messageId: info.messageId, response: info.response };
  } catch (error) {
    const explanation = explainSmtpError(error);
    console.error(`[SecureShare Mailer] Mail send failed for ${maskedTo}:\n-> ${explanation}`);
    const wrappedErr = new Error(explanation);
    wrappedErr.code = error.code || 'SMTP_SEND_FAILED';
    wrappedErr.raw = error;
    throw wrappedErr;
  }
}

module.exports = {
  transporter,
  verifyTransport,
  sendMail,
  explainSmtpError,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_FROM
};
