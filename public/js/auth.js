/**
 * SecureShare Auth Manager
 * Handles client-side authentication, session validation, and toast alerts
 */

// Toast notification helper
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Authentication Helpers
function getAuthToken() {
  return localStorage.getItem('secureshare_token');
}

function getCurrentUser() {
  const userStr = localStorage.getItem('secureshare_user');
  try {
    return userStr ? JSON.parse(userStr) : null;
  } catch (e) {
    return null;
  }
}

function setAuthSession(token, user) {
  localStorage.setItem('secureshare_token', token);
  localStorage.setItem('secureshare_user', JSON.stringify(user));
}

function clearAuthSession() {
  localStorage.removeItem('secureshare_token');
  localStorage.removeItem('secureshare_user');
}

function logout() {
  clearAuthSession();
  window.location.href = '/login.html';
}

// Route Guard for authenticated pages (dashboard, shares, storage)
function requireAuth() {
  const token = getAuthToken();
  if (!token) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

// Route Guard for guest-only pages (login, register)
function redirectIfAuthenticated() {
  const token = getAuthToken();
  if (token) {
    window.location.href = '/dashboard.html';
  }
}

// Initialize Auth forms on respective pages
document.addEventListener('DOMContentLoaded', () => {
  // Update user avatar initial and name if present
  const user = getCurrentUser();
  const avatarEl = document.getElementById('user-avatar');
  if (avatarEl && user && user.full_name) {
    avatarEl.textContent = user.full_name.charAt(0).toUpperCase();
  }

  // Register Form Handler
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    redirectIfAuthenticated();
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = registerForm.querySelector('button[type="submit"]');
      const fullName = document.getElementById('full_name').value.trim();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      if (!fullName || !email || !password) {
        showToast('Please fill in all required fields.', 'error');
        return;
      }

      if (password.length < 8) {
        showToast('Password must be at least 8 characters.', 'error');
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Sending Code...';

        const res = await fetch('/api/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: fullName, email, password })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Registration failed');
        }

        showToast('Verification code dispatched to your email!', 'success');
        // Store pending email for verification
        sessionStorage.setItem('pending_verify_email', email);
        setTimeout(() => {
          window.location.href = `/verify-otp.html?email=${encodeURIComponent(email)}`;
        }, 800);
      } catch (err) {
        showToast(err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Create Account';
      }
    });
  }

  // Login Form Handler
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    redirectIfAuthenticated();
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      if (!email || !password) {
        showToast('Please enter both email and password.', 'error');
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Signing in...';

        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (res.status === 403 && data.needsVerification) {
          showToast('Please verify your email before logging in.', 'error');
          sessionStorage.setItem('pending_verify_email', data.email);
          setTimeout(() => {
            window.location.href = `/verify-otp.html?email=${encodeURIComponent(data.email)}`;
          }, 1200);
          return;
        }

        if (!res.ok) {
          throw new Error(data.error || 'Invalid credentials');
        }

        setAuthSession(data.token, data.user);
        showToast('Welcome back to SecureShare!', 'success');
        setTimeout(() => {
          window.location.href = '/dashboard.html';
        }, 600);
      } catch (err) {
        showToast(err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Sign In';
      }
    });
  }

  // Logout Buttons
  const logoutBtns = document.querySelectorAll('.action-logout');
  logoutBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  });
});
