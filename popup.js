document.addEventListener('DOMContentLoaded', () => {
  const pagesRadios = document.querySelectorAll('input[name="pages"]');
  const customPagesSection = document.getElementById('custom-pages-section');
  const grabBtn = document.getElementById('grab-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const statusDiv = document.getElementById('status');
  const progressDiv = document.getElementById('progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  let isGrabbing = false;

  // Toggle custom pages input
  pagesRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      customPagesSection.style.display = radio.value === 'custom' ? 'block' : 'none';
    });
  });

  // Start grabbing
  grabBtn.addEventListener('click', async () => {
    const pagesValue = document.querySelector('input[name="pages"]:checked').value;
    const filename = document.getElementById('filename').value.trim();
    const format = document.getElementById('format').value;
    const pageCount = parseInt(document.getElementById('page-count').value) || 1;

    if (!filename) {
      showStatus('Nama file tidak boleh kosong', 'error');
      return;
    }

    isGrabbing = true;
    grabBtn.style.display = 'none';
    grabBtn.disabled = true;
    cancelBtn.style.display = 'block';
    statusDiv.textContent = '';
    progressDiv.style.display = 'block';
    progressFill.style.width = '0%';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Check if content script is available
      chrome.tabs.sendMessage(tab.id, { action: 'ping' }, (response) => {
        // If no response, content script is not loaded
        if (chrome.runtime.lastError) {
          showStatus(
            '❌ Error: Extension tidak bisa akses halaman ini. Pastikan Anda di studio.youtube.com dan sudah search musik.',
            'error'
          );
          resetUI();
          return;
        }

        // Send grab command
        chrome.tabs.sendMessage(tab.id, {
          action: 'grabData',
          pageMode: pagesValue,
          pageCount: pageCount,
          format: format,
          filename: filename
        });
      });
    } catch (error) {
      showStatus('❌ Error: ' + error.message, 'error');
      resetUI();
    }
  });

  // Cancel grabbing
  cancelBtn.addEventListener('click', () => {
    isGrabbing = false;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'stopGrab' }).catch(() => {});
      }
    });
    resetUI();
    showStatus('⏸️ Dibatalkan', 'warning');
  });

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateProgress') {
      progressFill.style.width = Math.min(request.progress, 99) + '%';
      progressText.textContent = request.message;
    } else if (request.action === 'grabComplete') {
      progressFill.style.width = '100%';
      resetUI();
      showStatus(request.message, 'success');
    } else if (request.action === 'grabError') {
      resetUI();
      showStatus('❌ ' + request.message, 'error');
    }
  });

  function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
  }

  function resetUI() {
    isGrabbing = false;
    grabBtn.style.display = 'block';
    grabBtn.disabled = false;
    cancelBtn.style.display = 'none';
    progressDiv.style.display = 'none';
    progressFill.style.width = '0%';
    progressText.textContent = '';
  }
});
