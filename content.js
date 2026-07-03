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
      
      await new Promise(resolve => setTimeout(resolve, 800));
      
      const pageData = extractCurrentPageData();
      console.log(`[CMG] Page ${currentPage}: Found ${pageData.length} tracks`);
      allData = allData.concat(pageData);

      const progress = Math.min((currentPage / (maxPages === 999 ? currentPage + 1 : maxPages)) * 100, 95);
      sendMessage('updateProgress', {
        progress: progress,
        message: `Halaman ${currentPage}: ${pageData.length} lagu | Total: ${allData.length} lagu`
      });

      if (currentPage >= maxPages) {
        console.log('[CMG] Reached maximum pages');
        break;
      }

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

    // Remove duplicates
    const uniqueData = deduplicateData(allData);
    console.log(`[CMG] Removed ${allData.length - uniqueData.length} duplicates. Final count: ${uniqueData.length}`);

    let fileContent;
    if (format === 'csv') {
      fileContent = convertToCSV(uniqueData);
    } else {
      fileContent = JSON.stringify(uniqueData, null, 2);
    }

    const extension = format === 'csv' ? 'csv' : 'json';
    const fullFilename = `${filename}.${extension}`;
    
    downloadFile(fileContent, fullFilename, format);

    sendMessage('grabComplete', {
      message: `✅ Berhasil grab ${uniqueData.length} lagu dari ${currentPage} halaman`
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
  const seenTitles = new Set();
  
  // More specific selector - look for individual track list items
  const trackRows = document.querySelectorAll('div[jsname] [role="gridcell"] a, [data-track-id] a, [class*="track-item"] a');
  console.log(`[CMG] Found ${trackRows.length} track link elements`);

  // Get unique rows by going up to the parent row container
  const uniqueRows = new Set();
  trackRows.forEach(link => {
    // Find the row container
    let row = link.closest('[role="row"], [class*="track-item"], [class*="list-item"]');
    if (!row) {
      row = link.closest('div[jsname]');
    }
    if (row) {
      uniqueRows.add(row);
    }
  });

  console.log(`[CMG] Found ${uniqueRows.size} unique track rows`);

  uniqueRows.forEach((row, index) => {
    try {
      let title = '';
      let artists = '';
      let youtubeLink = '';

      // Extract title - more specific
      const titleLink = row.querySelector('a[href*="music.youtube"], a[jsname]');
      if (titleLink) {
        const titleText = titleLink.textContent.trim();
        if (titleText && titleText.length > 0 && !titleText.startsWith('http')) {
          title = titleText;
        }
      }

      // If no title yet, try other selectors
      if (!title) {
        const allLinks = row.querySelectorAll('a');
        for (let link of allLinks) {
          const text = link.textContent.trim();
          if (text && text.length > 0 && !text.startsWith('http') && !text.match(/^\d+:\d+/)) {
            title = text;
            break;
          }
        }
      }

      // Extract artists
      const artistElements = row.querySelectorAll('a[href*="/channel/"], a[href*="/user/"], [class*="artist"]');
      const artistTexts = [];
      artistElements.forEach(el => {
        const text = el.textContent.trim();
        if (text && !text.includes('://') && text.length > 0 && !text.match(/^\d+/) && text !== title) {
          if (!artistTexts.includes(text)) {
            artistTexts.push(text);
          }
        }
      });
      artists = artistTexts.length > 0 ? artistTexts.join(', ') : 'Unknown';

      // Extract YouTube link - look for various YouTube URL patterns
      const allLinks = row.querySelectorAll('a[href]');
      for (let link of allLinks) {
        let href = link.getAttribute('href') || '';
        
        // Handle relative URLs
        if (href.startsWith('/')) {
          href = 'https://music.youtube.com' + href;
        }
        
        // Check if it's a YouTube URL
        if (href.includes('youtube.com') || href.includes('youtu.be') || href.includes('music.youtube.com')) {
          if (href.startsWith('http')) {
            youtubeLink = href;
          } else {
            youtubeLink = 'https://youtube.com' + href;
          }
          break;
        }
      }

      // Only add if we have a title and haven't seen it before
      if (title && title.length > 0 && !seenTitles.has(title)) {
        seenTitles.add(title);
        tracks.push({
          title: title,
          artist: artists,
          youtubeLink: youtubeLink || ''
        });
        console.log(`[CMG] Track ${index + 1}: ${title} - ${artists} - ${youtubeLink ? 'Link found' : 'No link'}`);
      }
    } catch (error) {
      console.error('[CMG] Error extracting track:', error);
    }
  });

  return tracks;
}

function deduplicateData(data) {
  const seen = new Map();
  const unique = [];

  data.forEach(track => {
    const key = `${track.title}|${track.artist}`;
    if (!seen.has(key)) {
      seen.set(key, true);
      unique.push(track);
    }
  });

  return unique;
}

async function scrollAndLoadMore() {
  try {
    const scrollContainer = document.querySelector('[role="main"], [class*="content"], [class*="results"]');
    
    if (scrollContainer) {
      const currentHeight = scrollContainer.scrollHeight;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      
      console.log('[CMG] Scrolling to load more content...');
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const newHeight = scrollContainer.scrollHeight;
      if (newHeight > currentHeight) {
        console.log('[CMG] New content loaded');
        return true;
      }
    }

    const nextButtons = document.querySelectorAll(
      'button[aria-label*="Next"], button[title*="Next"], [class*="next"] button'
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
    const link = document.createElement('a');
    
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);

    console.log('[CMG] File download initiated:', filename);
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
