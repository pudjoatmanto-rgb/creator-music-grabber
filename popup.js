document.addEventListener('DOMContentLoaded', () => {
  const pagesRadios = document.querySelectorAll('input[name="pages"]');
  const customPagesSection = document.getElementById('custom-pages-section');
  const grabBtn = document.getElementById('grab-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const statusDiv = document.getElementById('status');
  const progressDiv = document.getElementById('progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  // Toggle custom pages input
  pagesRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      customPagesSection.style.display = radio.value === 'custom' ? 'block' : 'none';
    });
  });

  // Start grabbing
  grabBtn.addEventListener('click', () => {
    const pagesValue = document.querySelector('input[name="pages"]:checked').value;
    const filename = document.getElementById('filename').value.trim();
    const format = document.getElementById('format').value;
    const pageCount = parseInt(document.getElementById('page-count').value) || 1;

    if (!filename) {
      showStatus('Nama file tidak boleh kosong', 'error');
      return;
    }

    grabBtn.disabled = true;
    cancelBtn.style.display = 'block';
    progressDiv.style.display = 'block';
    showStatus('Menghubungkan ke halaman...', 'info');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        showStatus('Error: Tidak ada tab aktif', 'error');
        resetUI();
        return;
      }

      try {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'grabData',
          pageMode: pagesValue,
          pageCount: pageCount,
          format: format,
          filename: filename
        });
        console.log('[CMG Popup] Message sent to content script');
      } catch (err) {
        console.error('[CMG Popup] Error sending message:', err);
        showStatus('Error: Tidak bisa menghubungi halaman', 'error');
        resetUI();
      }
    });
  });

  // Cancel grabbing
  cancelBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        try {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'stopGrab' });
        } catch (err) {
          console.error('[CMG Popup] Error stopping grab:', err);
        }
      }
    });
    resetUI();
    showStatus('Dibatalkan', 'warning');
  });

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[CMG Popup] Message received:', request.action);

    if (request.action === 'updateProgress') {
      const percent = Math.min(request.progress || 0, 99);
      progressFill.style.width = percent + '%';
      progressText.textContent = request.message || '';
    } else if (request.action === 'grabComplete') {
      progressFill.style.width = '100%';
      resetUI();
      showStatus(request.message || 'Selesai', 'success');
    } else if (request.action === 'grabError') {
      resetUI();
      showStatus('Error: ' + (request.message || 'Terjadi error'), 'error');
    }
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
  }

  function resetUI() {
    grabBtn.disabled = false;
    cancelBtn.style.display = 'none';
    progressDiv.style.display = 'none';
    progressFill.style.width = '0%';
    progressText.textContent = '';
  }
});
