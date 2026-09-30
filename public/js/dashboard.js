/**
 * SecureShare Dashboard Controller (My Files)
 * Implements files table rendering, live search, rename, delete, and download via signed URLs
 */

let userVaultFiles = [];

// Helper: format bytes into human-readable size
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper: format ISO timestamp
function formatDate(isoString) {
  if (!isoString) return 'Just now';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

// Helper: get icon name based on MIME type or file extension
function getFileIcon(type, name) {
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (t.includes('image') || n.match(/\.(png|jpg|jpeg|gif|webp|svg)$/)) return 'image';
  if (t.includes('pdf') || n.endsWith('.pdf')) return 'file-text';
  if (t.includes('zip') || t.includes('archive') || n.match(/\.(zip|tar|gz|rar)$/)) return 'archive';
  if (t.includes('video') || n.match(/\.(mp4|mov|avi|mkv)$/)) return 'video';
  if (t.includes('audio') || n.match(/\.(mp3|wav|ogg)$/)) return 'music';
  if (t.includes('code') || n.match(/\.(js|ts|html|css|py|json|sql)$/)) return 'code';
  return 'file';
}

// Fetch files from backend
async function fetchVaultFiles() {
  const token = getAuthToken();
  if (!token) return;

  try {
    const res = await fetch('/api/list-files', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 401) {
      logout();
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load vault files');

    userVaultFiles = data.files || [];
    renderFilesTable(userVaultFiles);
    updateStorageBadges(data.stats);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Render Files Table
function renderFilesTable(filesToDisplay) {
  const tableBody = document.getElementById('files-table-body');
  const filesCountBadge = document.getElementById('files-count-badge');
  const filesSectionLabel = document.getElementById('files-section-label');

  if (!tableBody) return;

  if (filesCountBadge) {
    const count = filesToDisplay.length;
    filesCountBadge.textContent = `${count} ${count === 1 ? 'file' : 'files'}`;
  }
  if (filesSectionLabel) {
    filesSectionLabel.textContent = `FILES (${filesToDisplay.length})`;
  }

  if (filesToDisplay.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" class="table-empty-row">
          <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
            <i data-lucide="file-question" style="width:36px; height:36px; color:var(--text-muted);"></i>
            <span style="font-weight:600; color:var(--text-primary);">No files in your encrypted vault</span>
            <span style="font-size:13px; color:var(--text-secondary);">Upload a file to begin sharing securely with signed URLs.</span>
            <button class="btn btn-primary action-open-upload" style="margin-top:8px;">
              <i data-lucide="upload" style="width:16px; height:16px;"></i>
              Upload File
            </button>
          </div>
        </td>
      </tr>
    `;
    if (window.lucide) window.lucide.createIcons();
    // Re-bind upload button
    setupUploadHandlers(fetchVaultFiles);
    return;
  }

  tableBody.innerHTML = filesToDisplay.map(file => {
    const icon = getFileIcon(file.file_type, file.file_name);
    const friendlyType = (file.file_type || 'Unknown').split('/')[1] || file.file_type || 'File';

    return `
      <tr data-file-id="${file.id}">
        <td>
          <div class="file-name-cell">
            <div class="file-type-icon">
              <i data-lucide="${icon}" style="width:18px; height:18px;"></i>
            </div>
            <div>
              <span class="file-name-text" style="display:block; font-weight:600; color:var(--text-primary); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${escapeHtml(file.file_name)}
              </span>
              <span style="font-size:11px; color:var(--text-muted); font-family:monospace;">
                ID: ${file.id.substring(0, 8)}...
              </span>
            </div>
          </div>
        </td>
        <td class="col-type">
          <span class="badge-pill">${escapeHtml(friendlyType.toUpperCase())}</span>
        </td>
        <td class="col-size" style="color:var(--text-secondary); font-size:13px;">
          ${formatBytes(file.file_size)}
        </td>
        <td style="color:var(--text-secondary); font-size:13px;">
          ${formatDate(file.created_at)}
        </td>
        <td>
          <div class="file-actions-cell">
            <!-- Share Modal Trigger -->
            <button class="btn-icon-sm action-share-file" title="Create Secure Share Link" data-id="${file.id}" data-name="${escapeHtml(file.file_name)}">
              <i data-lucide="share-2" style="width:15px; height:15px;"></i>
            </button>
            <!-- Direct Download via Signed URL -->
            <button class="btn-icon-sm action-download-file" title="Download File via Signed URL" data-id="${file.id}">
              <i data-lucide="download" style="width:15px; height:15px;"></i>
            </button>
            <!-- Rename File -->
            <button class="btn-icon-sm action-rename-file" title="Rename File" data-id="${file.id}" data-name="${escapeHtml(file.file_name)}">
              <i data-lucide="edit-3" style="width:15px; height:15px;"></i>
            </button>
            <!-- Delete File -->
            <button class="btn-icon-sm trash action-delete-file" title="Delete from Vault & Storage" data-id="${file.id}" data-name="${escapeHtml(file.file_name)}">
              <i data-lucide="trash-2" style="width:15px; height:15px;"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
  attachTableActionListeners();
}

function updateStorageBadges(stats) {
  if (!stats) return;
  const storagePill = document.getElementById('vault-storage-summary');
  if (storagePill) {
    storagePill.textContent = `${stats.totalMb} MB / ${stats.maxStorageMb} MB Used`;
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}

// Table action button listeners
function attachTableActionListeners() {
  const token = getAuthToken();

  // Download
  document.querySelectorAll('.action-download-file').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fileId = btn.getAttribute('data-id');
      try {
        btn.classList.add('loading');
        showToast('Generating 1-hour signed download URL...', 'info');

        const res = await fetch(`/api/download-file?file_id=${fileId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Failed to download file');

        // Trigger secure download via signed URL
        const link = document.createElement('a');
        link.href = data.downloadUrl;
        link.setAttribute('download', data.fileName || 'download');
        document.body.appendChild(link);
        link.click();
        link.remove();
        showToast('Download started.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.classList.remove('loading');
      }
    });
  });

  // Rename
  document.querySelectorAll('.action-rename-file').forEach(btn => {
    btn.addEventListener('click', () => {
      const fileId = btn.getAttribute('data-id');
      const currentName = btn.getAttribute('data-name');
      openRenameModal(fileId, currentName);
    });
  });

  // Delete
  document.querySelectorAll('.action-delete-file').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fileId = btn.getAttribute('data-id');
      const fileName = btn.getAttribute('data-name');
      if (confirm(`Are you sure you want to permanently delete "${fileName}"? This will remove the binary file from Supabase Storage and revoke any active share links.`)) {
        try {
          const res = await fetch('/api/delete-file', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ file_id: fileId })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Delete failed');

          showToast(`File "${fileName}" deleted.`, 'success');
          fetchVaultFiles();
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });
  });

  // Share
  document.querySelectorAll('.action-share-file').forEach(btn => {
    btn.addEventListener('click', () => {
      const fileId = btn.getAttribute('data-id');
      const fileName = btn.getAttribute('data-name');
      if (typeof window.openShareModal === 'function') {
        window.openShareModal(fileId, fileName);
      }
    });
  });
}

// Rename Modal Controller
function openRenameModal(fileId, currentName) {
  const modal = document.getElementById('rename-modal');
  const input = document.getElementById('rename-file-input');
  const form = document.getElementById('rename-form');
  const closeBtn = document.getElementById('close-rename-modal');

  if (!modal || !input || !form) return;

  input.value = currentName;
  modal.classList.add('open');
  input.focus();

  closeBtn.onclick = () => modal.classList.remove('open');

  form.onsubmit = async (e) => {
    e.preventDefault();
    const newName = input.value.trim();
    if (!newName) return;

    try {
      const token = getAuthToken();
      const res = await fetch('/api/rename-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ file_id: fileId, new_name: newName })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to rename');

      showToast('File renamed successfully.', 'success');
      modal.classList.remove('open');
      fetchVaultFiles();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  if (requireAuth()) {
    fetchVaultFiles();
    setupUploadHandlers(fetchVaultFiles);

    // Live Search filter
    const searchInput = document.getElementById('file-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const filtered = userVaultFiles.filter(f => f.file_name.toLowerCase().includes(query));
        renderFilesTable(filtered);
      });
    }

    // Refresh button
    const refreshBtn = document.getElementById('btn-refresh-files');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        showToast('Refreshing encrypted vault...', 'info');
        fetchVaultFiles();
      });
    }
  }
});
