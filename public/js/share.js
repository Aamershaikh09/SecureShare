/**
 * SecureShare Link Creator, Public Viewer & Shares Management
 */

// 1. Share Modal Logic (used in dashboard.html)
window.openShareModal = function(fileId, fileName) {
  const modal = document.getElementById('share-modal');
  const targetFileName = document.getElementById('share-modal-filename');
  const shareForm = document.getElementById('share-create-form');
  const resultContainer = document.getElementById('share-result-container');
  const generatedLinkInput = document.getElementById('generated-share-link');
  const closeBtn = document.getElementById('close-share-modal');
  const doneBtn = document.getElementById('btn-share-done');
  const copyBtn = document.getElementById('btn-copy-share-link');

  if (!modal) return;

  targetFileName.textContent = fileName;
  modal.classList.add('open');
  if (resultContainer) resultContainer.style.display = 'none';
  if (shareForm) shareForm.style.display = 'block';

  closeBtn.onclick = () => modal.classList.remove('open');
  if (doneBtn) doneBtn.onclick = () => modal.classList.remove('open');

  // Toggle password input visibility
  const passToggle = document.getElementById('share-enable-password');
  const passGroup = document.getElementById('share-password-field-group');
  if (passToggle && passGroup) {
    passToggle.onchange = () => {
      passGroup.style.display = passToggle.checked ? 'block' : 'none';
      if (passToggle.checked) {
        document.getElementById('share-password-input').focus();
      }
    };
  }

  // Handle Share Creation Form
  shareForm.onsubmit = async (e) => {
    e.preventDefault();
    const token = getAuthToken();
    const expiryVal = document.getElementById('share-expiry-select').value;
    const maxDlVal = document.getElementById('share-max-downloads').value;
    const enablePass = passToggle ? passToggle.checked : false;
    const password = enablePass ? document.getElementById('share-password-input').value.trim() : null;

    try {
      const submitBtn = shareForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = 'Generating Link...';

      const res = await fetch('/api/create-share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          file_id: fileId,
          password,
          expires_in: expiryVal,
          max_downloads: maxDlVal ? parseInt(maxDlVal, 10) : null
        })
      });

      const data = await res.json();
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Create Secure Link';

      if (!res.ok) throw new Error(data.error || 'Failed to create share link');

      // Build full public URL
      const fullUrl = `${window.location.origin}/share/${data.share.share_token}`;
      generatedLinkInput.value = fullUrl;

      shareForm.style.display = 'none';
      resultContainer.style.display = 'block';

      showToast('Secure link generated!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  if (copyBtn) {
    copyBtn.onclick = () => {
      generatedLinkInput.select();
      navigator.clipboard.writeText(generatedLinkInput.value);
      showToast('Link copied to clipboard!', 'success');
      copyBtn.innerHTML = '<i data-lucide="check" style="width:16px; height:16px;"></i> Copied';
      if (window.lucide) window.lucide.createIcons();
      setTimeout(() => {
        copyBtn.innerHTML = '<i data-lucide="copy" style="width:16px; height:16px;"></i> Copy Link';
        if (window.lucide) window.lucide.createIcons();
      }, 2000);
    };
  }
};

// 2. Shares Management List (shares.html)
async function fetchUserShares() {
  const token = getAuthToken();
  if (!token) return;

  try {
    const res = await fetch('/api/list-shares', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 401) {
      logout();
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch shares');

    renderSharesTable(data.shares || []);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderSharesTable(shares) {
  const tbody = document.getElementById('shares-table-body');
  const countBadge = document.getElementById('shares-count-badge');
  if (!tbody) return;

  if (countBadge) {
    countBadge.textContent = `${shares.length} ${shares.length === 1 ? 'share' : 'shares'}`;
  }

  if (shares.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty-row">
          <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
            <i data-lucide="share-2" style="width:36px; height:36px; color:var(--text-muted);"></i>
            <span style="font-weight:600; color:var(--text-primary);">No active shares</span>
            <span style="font-size:13px; color:var(--text-secondary);">Select a file from "My Files" to generate a tokenized download link.</span>
            <a href="/dashboard.html" class="btn btn-outline" style="margin-top:8px;">Go to My Files</a>
          </div>
        </td>
      </tr>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  tbody.innerHTML = shares.map(share => {
    const fullLink = `${window.location.origin}/share/${share.share_token}`;
    const isExpired = new Date(share.expires_at) < new Date();
    const isRevoked = share.is_revoked;

    let statusPill = '';
    if (isRevoked) {
      statusPill = `<span class="badge-pill red">REVOKED</span>`;
    } else if (isExpired) {
      statusPill = `<span class="badge-pill yellow">EXPIRED</span>`;
    } else {
      statusPill = `<span class="badge-pill green live-countdown" data-expires="${share.expires_at}">Active</span>`;
    }

    const passPill = share.has_password 
      ? `<span class="badge-pill blue"><i data-lucide="lock" style="width:12px; height:12px;"></i> Protected</span>`
      : `<span class="badge-pill">Public</span>`;

    const downloadsText = share.max_downloads 
      ? `${share.download_count} / ${share.max_downloads}`
      : `${share.download_count} downloads`;

    return `
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="file-type-icon">
              <i data-lucide="file-text" style="width:16px; height:16px;"></i>
            </div>
            <span style="font-weight:600; color:var(--text-primary); max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              ${escapeHtml(share.file_name)}
            </span>
          </div>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:6px;">
            <code style="font-size:12px; background:var(--bg-tertiary); padding:3px 6px; border-radius:6px; color:var(--primary);">
              /share/${share.share_token.substring(0, 8)}...
            </code>
            <button class="btn-icon-sm action-copy-link" data-url="${fullLink}" title="Copy full share link">
              <i data-lucide="copy" style="width:14px; height:14px;"></i>
            </button>
          </div>
        </td>
        <td>${passPill}</td>
        <td>${statusPill}</td>
        <td style="font-size:13px; color:var(--text-secondary);">${downloadsText}</td>
        <td>
          ${!isRevoked && !isExpired ? `
            <button class="btn-danger-outline action-revoke-share" data-id="${share.id}">
              Revoke
            </button>
          ` : `
            <span style="font-size:12px; color:var(--text-muted);">Inactive</span>
          `}
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
  attachSharesActionListeners();
  startLiveTimers();
}

function attachSharesActionListeners() {
  const token = getAuthToken();

  // Copy link
  document.querySelectorAll('.action-copy-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      navigator.clipboard.writeText(url);
      showToast('Share link copied to clipboard!', 'success');
    });
  });

  // Revoke link
  document.querySelectorAll('.action-revoke-share').forEach(btn => {
    btn.addEventListener('click', async () => {
      const shareId = btn.getAttribute('data-id');
      if (confirm('Are you sure you want to revoke this share link? Public downloads will be stopped immediately.')) {
        try {
          const res = await fetch('/api/revoke-share', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ share_id: shareId })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to revoke share');

          showToast('Share link has been revoked.', 'success');
          fetchUserShares();
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });
  });
}

function startLiveTimers() {
  const timerElements = document.querySelectorAll('.live-countdown');
  if (timerElements.length === 0) return;

  function update() {
    const now = Date.now();
    timerElements.forEach(el => {
      const expStr = el.getAttribute('data-expires');
      if (!expStr) return;
      const diff = new Date(expStr).getTime() - now;
      if (diff <= 0) {
        el.className = 'badge-pill yellow';
        el.textContent = 'Expired';
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 24) {
          const days = Math.floor(hours / 24);
          el.textContent = `${days}d left`;
        } else {
          el.textContent = `${hours}h ${mins}m left`;
        }
      }
    });
  }

  update();
  setInterval(update, 60000);
}

// 3. Public Share Viewer (share.html)
async function initPublicShareViewer() {
  // Extract token from path /share/:token or ?token=...
  let token = '';
  const pathParts = window.location.pathname.split('/');
  const shareIdx = pathParts.indexOf('share');
  if (shareIdx !== -1 && pathParts[shareIdx + 1]) {
    token = pathParts[shareIdx + 1];
  } else {
    const params = new URLSearchParams(window.location.search);
    token = params.get('token') || '';
  }

  const container = document.getElementById('public-share-view');
  if (!container || !token) return;

  try {
    const res = await fetch(`/api/access-share?token=${encodeURIComponent(token)}`);
    const data = await res.json();

    if (!res.ok || data.status === 'not_found' || data.status === 'revoked' || data.status === 'expired' || data.status === 'limit_reached') {
      renderShareError(data.error || 'Share link unavailable', data.status);
      return;
    }

    if (data.requiresPassword) {
      renderPasswordPrompt(token, data);
    } else {
      renderFileDownloadCard(token, data);
    }
  } catch (err) {
    renderShareError('Could not load shared file.', 'error');
  }
}

function renderPasswordPrompt(token, meta) {
  const container = document.getElementById('public-share-view');
  container.innerHTML = `
    <div class="auth-card" style="margin:0 auto;">
      <div style="width:48px; height:48px; border-radius:var(--radius-full); background:var(--primary-light); color:var(--primary); display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
        <i data-lucide="lock" style="width:24px; height:24px;"></i>
      </div>
      <h2 style="font-size:20px; font-weight:700; margin-bottom:8px;">Protected File</h2>
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:20px;">
        This file is encrypted and password-protected. Please enter the password to access.
      </p>

      <form id="share-password-form">
        <div class="form-group">
          <input type="password" id="share-unlock-password" class="form-input" placeholder="Enter share password" required autofocus>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;">
          <i data-lucide="key" style="width:16px; height:16px;"></i>
          Unlock File
        </button>
      </form>
      <div id="unlock-error" style="color:var(--danger); font-size:13px; margin-top:12px; display:none;"></div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();

  document.getElementById('share-password-form').onsubmit = async (e) => {
    e.preventDefault();
    const pwd = document.getElementById('share-unlock-password').value;
    const errBox = document.getElementById('unlock-error');
    errBox.style.display = 'none';

    try {
      const res = await fetch(`/api/access-share?token=${encodeURIComponent(token)}&password=${encodeURIComponent(pwd)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Incorrect password');
      }
      renderFileDownloadCard(token, data, pwd);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    }
  };
}

function renderFileDownloadCard(token, file, password = '') {
  const container = document.getElementById('public-share-view');
  const sizeText = formatBytes(file.fileSize);
  const typeText = (file.fileType || 'file').split('/')[1] || file.fileType || 'document';

  // Expiry countdown
  const expDate = new Date(file.expiresAt);
  const formattedExpiry = expDate.toLocaleString();

  container.innerHTML = `
    <div class="card" style="max-width:480px; margin:0 auto; text-align:center; padding:36px 32px;">
      <!-- Big File Icon -->
      <div style="width:72px; height:72px; border-radius:16px; background:var(--primary-light); color:var(--primary); display:flex; align-items:center; justify-content:center; margin:0 auto 20px;">
        <i data-lucide="file-text" style="width:36px; height:36px;"></i>
      </div>

      <!-- File Name & Meta -->
      <h2 style="font-size:22px; font-weight:700; color:var(--text-primary); margin-bottom:6px; word-break:break-word;">
        ${escapeHtml(file.fileName)}
      </h2>

      <div style="display:flex; justify-content:center; gap:8px; margin-bottom:20px; flex-wrap:wrap;">
        <span class="badge-pill">${escapeHtml(typeText.toUpperCase())}</span>
        <span class="badge-pill">${sizeText}</span>
        <span class="badge-pill blue" id="public-expiry-pill">
          <i data-lucide="clock" style="width:12px; height:12px;"></i>
          Valid until ${formattedExpiry}
        </span>
      </div>

      <!-- Download Button -->
      <button id="btn-public-download" class="btn btn-primary" style="width:100%; padding:14px; font-size:15px; margin-bottom:14px;">
        <i data-lucide="download" style="width:18px; height:18px;"></i>
        Download File Securely
      </button>

      <p style="font-size:12px; color:var(--text-muted); line-height:1.5;">
        Protected by SecureShare isolated cloud vault.<br>Download URL is cryptographically signed and ephemeral.
      </p>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();

  document.getElementById('btn-public-download').onclick = async () => {
    const btn = document.getElementById('btn-public-download');
    btn.disabled = true;
    btn.innerHTML = 'Generating Signed Stream...';

    try {
      let url = `/api/access-share?token=${encodeURIComponent(token)}&action=download`;
      if (password) url += `&password=${encodeURIComponent(password)}`;

      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to download');

      const a = document.createElement('a');
      a.href = data.downloadUrl;
      a.setAttribute('download', data.fileName);
      document.body.appendChild(a);
      a.click();
      a.remove();

      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="check" style="width:18px; height:18px;"></i> Download Started!';
      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="download" style="width:18px; height:18px;"></i> Retry Download';
      if (window.lucide) window.lucide.createIcons();
    }
  };
}

function renderShareError(message, status) {
  const container = document.getElementById('public-share-view');
  let icon = 'alert-triangle';
  let title = 'Link Unavailable';

  if (status === 'revoked') {
    icon = 'shield-alert';
    title = 'Link Revoked';
  } else if (status === 'expired') {
    icon = 'clock';
    title = 'Link Expired';
  } else if (status === 'limit_reached') {
    icon = 'lock';
    title = 'Download Limit Reached';
  }

  container.innerHTML = `
    <div class="card" style="max-width:440px; margin:0 auto; text-align:center; padding:40px 32px;">
      <div style="width:64px; height:64px; border-radius:var(--radius-full); background:#FEF2F2; color:var(--danger); display:flex; align-items:center; justify-content:center; margin:0 auto 20px;">
        <i data-lucide="${icon}" style="width:32px; height:32px;"></i>
      </div>
      <h2 style="font-size:22px; font-weight:700; color:var(--text-primary); margin-bottom:8px;">${title}</h2>
      <p style="font-size:14px; color:var(--text-secondary); margin-bottom:24px; line-height:1.5;">${message}</p>
      <a href="/" class="btn btn-outline" style="width:100%;">Return to SecureShare</a>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

// Initialise viewer if on share.html or shares list if on shares.html
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('public-share-view')) {
    initPublicShareViewer();
  }
  if (document.getElementById('shares-table-body')) {
    if (requireAuth()) {
      fetchUserShares();
    }
  }
});
