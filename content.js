console.log('[CMG] Content script loaded');

let isGrabbing = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[CMG] Message received:', request.action);
  
  if (request.action === 'grabData') {
    grabData(request.pageMode, request.pageCount, request.format, request.filename);
  } else if (request.action === 'stopGrab') {
    isGrabbing = false;
  }
});

async function grabData(pageMode, pageCount, format, filename) {
  isGrabbing = true;
  let allData = [];
  let currentPage = 1;
  const maxPages = pageMode === 'all' ? 999 : pageMode === 'custom' ? pageCount : 1;

  try {
    while (currentPage <= maxPages && isGrabbing) {
      console.log(`[CMG] Processing page ${currentPage}...`);
      
      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Get current page data
      const pageData = extractCurrentPageData();
      console.log(`[CMG] Page ${currentPage}: Found ${pageData.length} tracks`);
      allData = allData.concat(pageData);

      const progress = Math.min((currentPage / (maxPages === 999 ? currentPage + 1 : maxPages)) * 100, 95);
      sendMessage('updateProgress', {
        progress: progress,
        message: `Halaman ${currentPage}: ${pageData.length} lagu | Total: ${allData.length} lagu`
      });

      // Check if we should continue
      if (currentPage >= maxPages) {
        console.log('[CMG] Reached maximum pages');
        break;
      }

      // Try to load next page
      if (pageMode === 'all' || currentPage < maxPages) {
        const hasNextPage = await scrollAndLoadMore();
        if (!hasNextPage) {
          console.log('[CMG] No more pages available');
          if (pageMode === 'all') break;
        }
        currentPage++;
      }
    }

    if (!isGrabbing) {
      sendMessage('grabError', { message: 'Dibatalkan oleh user' });
      return;
    }

    if (allData.length === 0) {
      sendMessage('grabError', { message: 'Tidak ada data yang ditemukan. Pastikan Anda di halaman hasil pencarian.' });
      return;
    }

    // Convert to desired format
    let fileContent;
    if (format === 'csv') {
      fileContent = convertToCSV(allData);
    } else {
      fileContent = JSON.stringify(allData, null, 2);
    }

    const extension = format === 'csv' ? 'csv' : 'json';
    downloadFile(fileContent, `${filename}.${extension}`, format);

    sendMessage('grabComplete', {
      message: `✅ Berhasil grab ${allData.length} lagu dari ${currentPage} halaman`
    });
    
  } catch (error) {
    console.error('[CMG] Error:', error);
    sendMessage('grabError', { message: error.message });
  } finally {
    isGrabbing = false;
  }
}

function extractCurrentPageData() {
  const tracks = [];
  
  // Get all track rows - looking for the container with track data
  const trackRows = document.querySelectorAll('[class*="ytmus-entity-list-item-track"], [role="row"][class*="track"]');
  console.log(`[CMG] Found ${trackRows.length} track elements on page`);

  trackRows.forEach((row, index) => {
    try {
      let title = '';
      let artists = '';
      let youtubeLink = '';

      // Extract title - look for the main title link
      const titleLink = row.querySelector('a[class*="title-link"], a[class*="title"][href]');
      if (titleLink) {
        title = titleLink.textContent.trim();
      }

      // Extract artists - look for artist links
      const artistLinks = row.querySelectorAll('a[class*="artist-link"], a[href*="/channel/"], a[href*="/user/"]');
      const artistTexts = [];
      artistLinks.forEach(link => {
        const text = link.textContent.trim();
        // Filter out non-artist text
        if (text && !text.includes('://') && text.length > 0 && !text.match(/^\d+/)  ) {
          artistTexts.push(text);
        }
      });
      artists = artistTexts.join(', ') || 'Unknown';

      // Extract YouTube link - look for any YouTube URL
      const allLinks = row.querySelectorAll('a[href]');
      for (let link of allLinks) {
        const href = link.getAttribute('href') || '';
        if (href.includes('youtube.com') || href.includes('youtu.be')) {
          youtubeLink = href.startsWith('http') ? href : 'https://youtube.com' + href;
          break;
        }
      }

      // Only add if we have at least a title
      if (title && title.length > 0) {
        tracks.push({
          title: title,
          artist: artists,
          youtubeLink: youtubeLink || 'Link not found'
        });
        console.log(`[CMG] Track ${index + 1}: ${title} - ${artists}`);
      }
    } catch (error) {
      console.error('[CMG] Error extracting track:', error);
    }
  });

  return tracks;
}

async function scrollAndLoadMore() {
  try {
    // Find the scrollable container
    const scrollContainer = document.querySelector('[role="main"], [class*="content-container"], [class*="search-results-container"]');
    
    if (scrollContainer) {
      // Scroll to bottom to trigger lazy loading
      const currentScroll = scrollContainer.scrollTop;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      
      console.log('[CMG] Scrolling to load more content...');
      
      // Wait for new content to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if new content was loaded by comparing heights
      if (scrollContainer.scrollHeight > currentScroll) {
        return true;
      }
    }

    // Try to find and click next page button
    const nextButtons = document.querySelectorAll(
      'button[aria-label*="Next"], button[title*="Next"], [class*="next-page"] button, button[aria-label*="next"]'
    );
    
    for (let btn of nextButtons) {
      if (btn && !btn.disabled) {
        console.log('[CMG] Found next button, clicking...');
        btn.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('[CMG] Error in scrollAndLoadMore:', error);
    return false;
  }
}

function convertToCSV(data) {
  if (data.length === 0) return 'Title,Artist,YouTube Link';

  const headers = ['Title', 'Artist', 'YouTube Link'];
  const rows = data.map(track => [
    escapeCSVField(track.title),
    escapeCSVField(track.artist),
    escapeCSVField(track.youtubeLink)
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

function escapeCSVField(field) {
  const str = String(field || '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function downloadFile(content, filename, mimeType) {
  try {
    const mimeTypes = {
      'csv': 'text/csv;charset=utf-8;',
      'json': 'application/json;charset=utf-8;'
    };

    const mime = mimeTypes[mimeType] || 'text/plain;charset=utf-8;';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);

    // Use chrome.downloads API
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });

    console.log('[CMG] Download initiated:', filename);
  } catch (error) {
    console.error('[CMG] Download error:', error);
    throw new Error('Gagal mendownload file: ' + error.message);
  }
}

function sendMessage(action, data) {
  try {
    chrome.runtime.sendMessage({
      action: action,
      ...data
    });
  } catch (error) {
    console.error('[CMG] Message send error:', error);
  }
}
