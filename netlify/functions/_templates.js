/**
 * Email Templates for SecureShare
 */

function getOtpEmailTemplate(otpCode, userName = 'there') {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your SecureShare Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F9FAFB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #111827;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F9FAFB; padding: 40px 10px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 20px 32px; border-bottom: 1px solid #F3F4F6; text-align: left;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color: #2563EB; width: 36px; height: 36px; border-radius: 8px; text-align: center; vertical-align: middle;">
                    <span style="color: #FFFFFF; font-size: 20px; line-height: 1; font-weight: bold;">&#128274;</span>
                  </td>
                  <td style="padding-left: 12px;">
                    <span style="font-size: 18px; font-weight: 700; color: #111827; letter-spacing: -0.3px;">SecureShare</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px; text-align: left;">
              <h2 style="margin: 0 0 12px 0; font-size: 22px; font-weight: 700; color: #111827;">Verify Your Account</h2>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #4B5563;">
                Hi <strong>${userName}</strong>,<br>
                Thank you for choosing SecureShare. Use the following 6-digit one-time passcode (OTP) to complete your verification:
              </p>

              <!-- OTP Box -->
              <div style="background-color: #EFF6FF; border: 1.5px dashed #93C5FD; border-radius: 10px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #2563EB; display: inline-block; font-family: monospace;">
                  ${otpCode}
                </span>
              </div>

              <p style="margin: 0 0 12px 0; font-size: 13px; line-height: 1.5; color: #6B7280;">
                &#9201; <strong>This code expires in 10 minutes.</strong><br>
                If you did not request this verification code, please ignore this email or contact support. Never share this code with anyone.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #F9FAFB; border-top: 1px solid #E5E7EB; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #9CA3AF;">
                &copy; 2026 SecureShare &bull; Encrypted Cloud Vault &bull; Isolated Vault Security
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = `SecureShare Verification Code: ${otpCode}\n\nHi ${userName},\nYour 6-digit OTP is ${otpCode}. It expires in 10 minutes.\nDo not share this code with anyone.\n\n- SecureShare Team`;

  return { html, text };
}

module.exports = {
  getOtpEmailTemplate
};
