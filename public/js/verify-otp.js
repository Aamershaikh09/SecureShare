/**
 * SecureShare OTP Verification Logic
 * Features:
 * - 6 Large OTP digit boxes with auto-advance and backspace navigation
 * - Full clipboard paste support (splits 6 digits across boxes)
 * - 30-second resend cooldown timer
 * - 10-minute live expiry countdown timer
 */

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const emailParam = urlParams.get('email') || sessionStorage.getItem('pending_verify_email') || '';
  const emailDisplay = document.getElementById('target-email-display');
  const otpInputs = document.querySelectorAll('.otp-box');
  const verifyBtn = document.getElementById('btn-verify-otp');
  const resendBtn = document.getElementById('btn-resend-otp');
  const resendCountdownText = document.getElementById('resend-countdown');
  const expiryTimerDisplay = document.getElementById('expiry-timer-display');

  if (emailDisplay && emailParam) {
    emailDisplay.textContent = emailParam;
  }

  if (!emailParam) {
    showToast('No email found for verification. Please register or log in.', 'error');
    setTimeout(() => window.location.href = '/register.html', 1500);
    return;
  }

  // 1. Auto-advance, backspace, and arrow keys handling
  otpInputs.forEach((input, index) => {
    // Only accept numeric input
    input.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val.length > 0) {
        // Keep only single numeric digit
        input.value = val.replace(/[^0-9]/g, '').slice(-1);
        if (input.value && index < otpInputs.length - 1) {
          otpInputs[index + 1].focus();
        }
      }
      checkIfCompleteAndSubmit();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!input.value && index > 0) {
          otpInputs[index - 1].focus();
          otpInputs[index - 1].value = '';
        }
      } else if (e.key === 'ArrowLeft' && index > 0) {
        otpInputs[index - 1].focus();
      } else if (e.key === 'ArrowRight' && index < otpInputs.length - 1) {
        otpInputs[index + 1].focus();
      }
    });

    // Paste support: Handles full 6-digit paste across boxes
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text');
      const cleanDigits = pasteData.replace(/[^0-9]/g, '').slice(0, 6);

      if (cleanDigits.length > 0) {
        cleanDigits.split('').forEach((digit, i) => {
          if (otpInputs[i]) {
            otpInputs[i].value = digit;
          }
        });
        const nextFocus = Math.min(cleanDigits.length, otpInputs.length - 1);
        otpInputs[nextFocus].focus();
        checkIfCompleteAndSubmit();
      }
    });
  });

  // Focus first input automatically
  if (otpInputs.length > 0) {
    otpInputs[0].focus();
  }

  function getEnteredOtp() {
    let code = '';
    otpInputs.forEach(i => code += i.value);
    return code;
  }

  function checkIfCompleteAndSubmit() {
    const code = getEnteredOtp();
    if (code.length === 6) {
      handleVerification();
    }
  }

  // 2. Submit Verification Code
  async function handleVerification() {
    const code = getEnteredOtp();
    if (code.length !== 6) {
      showToast('Please enter all 6 digits of the verification code.', 'error');
      return;
    }

    try {
      verifyBtn.disabled = true;
      verifyBtn.innerHTML = 'Verifying...';

      const res = await fetch('/api/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailParam, otp: code })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      setAuthSession(data.token, data.user);
      showToast('Verification successful! Opening your encrypted vault...', 'success');
      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 700);
    } catch (err) {
      showToast(err.message, 'error');
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = 'Verify & Enter Vault';
    }
  }

  if (verifyBtn) {
    verifyBtn.addEventListener('click', handleVerification);
  }

  // 3. 30-Second Resend Cooldown
  let cooldownSec = 30;
  let cooldownInterval = null;

  function startResendCooldown() {
    cooldownSec = 30;
    resendBtn.disabled = true;
    resendBtn.style.pointerEvents = 'none';
    resendBtn.style.color = 'var(--text-muted)';

    if (cooldownInterval) clearInterval(cooldownInterval);

    cooldownInterval = setInterval(() => {
      cooldownSec--;
      if (resendCountdownText) {
        resendCountdownText.textContent = `(Wait ${cooldownSec}s)`;
      }
      if (cooldownSec <= 0) {
        clearInterval(cooldownInterval);
        resendBtn.disabled = false;
        resendBtn.style.pointerEvents = 'auto';
        resendBtn.style.color = 'var(--primary)';
        if (resendCountdownText) resendCountdownText.textContent = '';
      }
    }, 1000);
  }

  startResendCooldown();

  if (resendBtn) {
    resendBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (cooldownSec > 0) return;

      try {
        resendBtn.disabled = true;
        const res = await fetch('/api/resend-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailParam })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to resend code');

        showToast('Fresh 6-digit code sent to your email!', 'success');
        startResendCooldown();
        resetExpiryTimer();
      } catch (err) {
        showToast(err.message, 'error');
        resendBtn.disabled = false;
      }
    });
  }

  // 4. Live 10-Minute Expiry Countdown Timer
  let expirySeconds = 10 * 60;
  let expiryInterval = null;

  function resetExpiryTimer() {
    expirySeconds = 10 * 60;
    if (expiryInterval) clearInterval(expiryInterval);

    expiryInterval = setInterval(() => {
      expirySeconds--;
      if (expirySeconds <= 0) {
        clearInterval(expiryInterval);
        if (expiryTimerDisplay) {
          expiryTimerDisplay.textContent = 'Expired';
          expiryTimerDisplay.style.color = 'var(--danger)';
        }
        showToast('Verification code has expired. Please request a new one.', 'error');
        return;
      }

      const mins = Math.floor(expirySeconds / 60);
      const secs = expirySeconds % 60;
      const formatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      if (expiryTimerDisplay) {
        expiryTimerDisplay.textContent = `Expires in ${formatted}`;
      }
    }, 1000);
  }

  resetExpiryTimer();
});
