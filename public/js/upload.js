// public/js/upload.js
/**
 * SecureShare Vault File Uploader
 * 
 * Responsibilities:
 * 1. Client-side file size validation (strictly caps files at 50MB)
 * 2. Sends file payload to the Netlify serverless endpoint: /.netlify/functions/save-file
 * 3. Utilizes XMLHttpRequest (xhr.upload.onprogress) for real-time progress bar feedback
 * 4. Consistently parses standard response contract: { success: boolean, data?: any, error?: string }
 * 5. Handles drag-and-drop, file browsing, and error alerts with graceful feedback
 */

const UPLOAD_ENDPOINT = '/.netlify/functions/save-file';
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB Limit

/**
 * Uploads a file via XMLHttpRequest to track upload progress
 * 
 * @param {File} file - The file object from input or dropzone
 * @param {Function} onProgress - Callback receiving numeric percentage (0-100)
 * @returns {Promise<Object>} Resolves with the saved file record data
 */
function uploadFileToVault(file, onProgress) {
  return new Promise((resolve, reject) => {
    // 1. Client-Side Size Enforcement
    if (!file) {
      return reject(new Error('No file selected for upload.'));
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      return reject(new Error(`File "${file.name}" is ${sizeMb} MB. Maximum allowed size is 50 MB.`));
    }

    // 2. Read file data to base64
    const reader = new FileReader();

    reader.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        // First 15% allocated to local file reading
        const readPercent = Math.round((e.loaded / e.total) * 15);
        onProgress(readPercent);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file from local device.'));
    };

    reader.onload = () => {
      const base64Data = (reader.result).split(',')[1];
      if (!base64Data) {
        return reject(new Error('Failed to encode file content.'));
      }

      // 3. Dispatch via XMLHttpRequest to capture network upload progress
      const xhr = new XMLHttpRequest();
      xhr.open('POST', UPLOAD_ENDPOINT, true);
      xhr.setRequestHeader('Content-Type', 'application/json');

      // Attach auth token if user is signed in
      const token = typeof getAuthToken === 'function' 
        ? getAuthToken() 
        : localStorage.getItem('secureshare_token');

      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      // Network Progress Listener
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          // Scale network progress from 15% to 95%
          const percent = 15 + Math.round((event.loaded / event.total) * 80);
          onProgress(Math.min(percent, 95));
        }
      };

      // Server Response Listener
      xhr.onload = () => {
        let response = {};
        try {
          response = JSON.parse(xhr.responseText || '{}');
        } catch (jsonErr) {
          response = {
            success: false,
            error: `Server returned invalid response (Status ${xhr.status}): ${xhr.statusText}`
          };
        }

        // Validate consistent response contract: { success, data, error }
        if (xhr.status >= 200 && xhr.status < 300 && response.success) {
          if (onProgress) onProgress(100);
          resolve(response.data);
        } else {
          let errorMsg = response.error;
          if (!errorMsg) {
            if (xhr.status === 413) {
              errorMsg = 'Upload rejected: Payload too large (Exceeds server 50MB limit).';
            } else if (xhr.status === 404) {
              errorMsg = `Upload endpoint not found (${UPLOAD_ENDPOINT}). Check Netlify function deployment.`;
            } else if (xhr.status === 405) {
              errorMsg = 'Method not allowed on upload endpoint.';
            } else {
              errorMsg = `Upload failed with status ${xhr.status}.`;
            }
          }
          reject(new Error(errorMsg));
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error during upload. Please check your internet connection or server status.'));
      };

      xhr.ontimeout = () => {
        reject(new Error('Upload request timed out. Please try again.'));
      };

      // Construct JSON payload
      const payload = JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
        fileData: base64Data
      });

      xhr.send(payload);
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Initializes Upload Modal, Drag-and-Drop dropzone, and file picker inputs
 * 
 * @param {Function} onUploadComplete - Callback executed after successful upload to refresh vault list
 */
function setupUploadHandlers(onUploadComplete) {
  const uploadModal = document.getElementById('upload-modal');
  const openUploadBtns = document.querySelectorAll('.action-open-upload');
  const closeUploadBtn = document.getElementById('close-upload-modal');
  const dropzone = document.getElementById('file-dropzone');
  const fileInput = document.getElementById('file-picker-input');
  const progressBarContainer = document.getElementById('upload-progress-container');
  const progressBar = document.getElementById('upload-progress-bar');
  const uploadStatusText = document.getElementById('upload-status-text');

  // Open Modal Triggers
  if (openUploadBtns) {
    openUploadBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        resetUploadUI();
        if (uploadModal) uploadModal.classList.add('open');
      });
    });
  }

  // Close Modal Trigger
  if (closeUploadBtn && uploadModal) {
    closeUploadBtn.addEventListener('click', () => {
      uploadModal.classList.remove('open');
      resetUploadUI();
    });
  }

  function resetUploadUI() {
    if (progressBarContainer) progressBarContainer.style.display = 'none';
    if (progressBar) {
      progressBar.style.width = '0%';
      progressBar.style.backgroundColor = 'var(--primary)';
    }
    if (uploadStatusText) {
      uploadStatusText.textContent = '';
      uploadStatusText.style.color = 'var(--text-primary)';
    }
    if (fileInput) fileInput.value = '';
    if (dropzone) dropzone.classList.remove('dragover');
  }

  // Drag and Drop Handling
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        handleFileProcessing(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleFileProcessing(fileInput.files[0]);
      }
    });
  }

  // Execute Upload & UI Progression
  async function handleFileProcessing(file) {
    if (!file) return;

    // Preliminary 50MB check with immediate feedback
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      const errMsg = `File "${file.name}" is ${sizeMb} MB. Maximum allowed upload size is 50 MB.`;
      if (typeof showToast === 'function') showToast(errMsg, 'error');
      if (uploadStatusText) {
        uploadStatusText.textContent = errMsg;
        uploadStatusText.style.color = 'var(--danger)';
      }
      return;
    }

    try {
      if (progressBarContainer) progressBarContainer.style.display = 'block';
      if (progressBar) {
        progressBar.style.width = '5%';
        progressBar.style.backgroundColor = 'var(--primary)';
      }
      if (uploadStatusText) {
        uploadStatusText.style.color = 'var(--text-primary)';
        uploadStatusText.textContent = `Preparing "${file.name}" for upload...`;
      }

      const uploadedData = await uploadFileToVault(file, (percent) => {
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (uploadStatusText) {
          uploadStatusText.textContent = `Uploading "${file.name}" (${percent}%)...`;
        }
      });

      if (progressBar) progressBar.style.width = '100%';
      if (uploadStatusText) {
        uploadStatusText.textContent = 'Upload complete! File stored in vault.';
      }
      if (typeof showToast === 'function') {
        showToast(`Successfully uploaded "${file.name}" to vault.`, 'success');
      }

      // Close modal and refresh files table
      setTimeout(() => {
        if (uploadModal) uploadModal.classList.remove('open');
        resetUploadUI();
        if (typeof onUploadComplete === 'function') {
          onUploadComplete(uploadedData);
        }
      }, 700);

    } catch (err) {
      console.error('[Upload Error]', err);
      if (typeof showToast === 'function') {
        showToast(err.message, 'error');
      }
      if (uploadStatusText) {
        uploadStatusText.textContent = `Upload failed: ${err.message}`;
        uploadStatusText.style.color = 'var(--danger)';
      }
      if (progressBar) {
        progressBar.style.backgroundColor = 'var(--danger)';
      }
    }
  }
}

// Attach globally
window.setupUploadHandlers = setupUploadHandlers;
window.uploadFileToVault = uploadFileToVault;
