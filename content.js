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
      console.log(`[CMG] Page ${currentPage}: Found ${pageData.length} tracks before dedup`);
      
      // Deduplicate data from this page
      const uniquePageData = deduplicateData(pageData);
      console.log(`[CMG] Page ${currentPage}: ${uniquePageData.length} unique tracks after dedup`);
      
      allData = allData.concat(uniquePageData);

      const progress = Math.min((currentPage / (maxPages === 999 ? currentPage + 1 : maxPages)) * 100, 95);
      sendMessage('updateProgress', {
        progress: progress,
        message: `Halaman ${currentPage}: ${uniquePageData.length} lagu | Total: ${allData.length} lagu`
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

    // Final deduplication across all pages
    const finalData = deduplicateData(allData);
    console.log(`[CMG] Final: ${allData.length} total tracks, ${finalData.length} after final dedup`);

    let fileContent;
    if (format === 'csv') {
      fileContent = convertToCSV(finalData);
    } else {
      fileContent = JSON.stringify(finalData, null, 2);
    }

    const extension = format === 'csv' ? 'csv' : 'json';
    const fullFilename = `${filename}.${extension}`;
    
    downloadFile(fileContent, fullFilename, format);

    sendMessage('grabComplete', {
      message: `✅ Berhasil grab ${finalData.length} lagu unik dari ${currentPage} halaman`
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
  
  // Try multiple selectors to find track rows
  let trackRows = document.querySelectorAll('[class*="ytmus-entity-list-item-track"]');
  
  if (trackRows.length === 0) {
    trackRows = document.querySelectorAll('[role="row"][data-track-id], [role="row"] [data-track-id]');
  }
  
  if (trackRows.length === 0) {
    trackRows = document.querySelectorAll('[class*="track-item"], [class*="list-item"]');
  }
  
  if (trackRows.length === 0) {
    // Fallback: look for elements containing music track info
    trackRows = document.querySelectorAll('[jsname] a[href*="watch"], [jsname] a[href*="music"]');
  }

  console.log(`[CMG] Found ${trackRows.length} track elements on page`);

  trackRows.forEach((row, index) => {
    try {
      let title = '';
      let artists = '';
      let youtubeLink = '';

      // Extract title - look for the main title link
      let titleElement = row.querySelector ? row.querySelector('a[class*="title"], a[href*="watch"], a[href*="music"]') : null;
      
      if (!titleElement && row.textContent) {
        // If row is already a link, use it
        if (row.tagName === 'A') {
          titleElement = row;
        }
      }

      if (titleElement) {
        title = titleElement.textContent.trim();
      }

      // If we still don't have title from row, try parent
      if (!title && row.parentElement) {
        const parentLinks = row.parentElement.querySelectorAll('a');
        for (let link of parentLinks) {
          const text = link.textContent.trim();
          if (text && !text.includes('://') && text.length > 2) {
            title = text;
            break;
          }
        }
      }

      // Extract artists - look for artist links
      let artistContainer = row.querySelector ? row.querySelector('[class*="artist"], [class*="subtitle"]') : null;
      let artistLinks = [];
      
      if (artistContainer) {
        artistLinks = artistContainer.querySelectorAll('a');
      } else if (row.querySelectorAll) {
        artistLinks = row.querySelectorAll('a[class*="artist"], a[href*="/channel/"], a[href*="/user/"]');
      }

      const artistTexts = [];
      artistLinks.forEach(link => {
        const text = link.textContent.trim();
        if (text && !text.includes('://') && text.length > 0 && !text.match(/^\d+/) && !artistTexts.includes(text)) {
          artistTexts.push(text);
        }
      });
      artists = artistTexts.join(', ') || 'Unknown';

      // Extract YouTube link
      let links = [];
      if (row.querySelectorAll) {
        links = Array.from(row.querySelectorAll('a[href]'));
      } else if (row.tagName === 'A' && row.href) {
        links = [row];
      }

      for (let link of links) {
        let href = link.getAttribute('href') || link.href || '';
        if (href.includes('youtube.com') || href.includes('youtu.be') || href.includes('music.youtube.com')) {
          if (href.startsWith('http')) {
            youtubeLink = href;
          } else if (href.startsWith('/')) {
            youtubeLink = 'https://music.youtube.com' + href;
          }
          break;
        }
      }

      // Only add if we have a title
      if (title && title.length > 2) {
        tracks.push({
          title: title,
          artist: artists,
          youtubeLink: youtubeLink || ''
        });
        console.log(`[CMG] Track ${index + 1}: ${title} - ${artists}`);
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
    // Create key from title only (more reliable than title+artist)
    const key = track.title.toLowerCase().trim();
    
    if (!seen.has(key)) {
      seen.set(key, true);
      unique.push(track);
    }
  });

  return unique;
}

async function scrollAndLoadMore() {
  try {
    const scrollContainer = document.querySelector('[role="main"], [class*="content-container"], [class*="search-results"]');
    
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
