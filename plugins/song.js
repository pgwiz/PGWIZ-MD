const axios = require('axios');
const fs = require('fs');

const API_BASE = 'https://api3.wpg.qzz.io';
const AXIOS_TIMEOUT = 60000;

// Store pending searches: chatId -> [results]
// Use global state to persist across hot-reloads
global.songSelections = global.songSelections || new Map();
const pendingSelections = global.songSelections;

// Clear cache every hour
if (!global.songSelectionCleaner) {
  global.songSelectionCleaner = setInterval(() => pendingSelections.clear(), 3600000);
}

async function handleSongSelection(sock, chatId, senderId, text, message) {
  if (!pendingSelections.has(chatId)) return false;

  const selectionIndex = parseInt(text.trim());
  if (isNaN(selectionIndex)) return false; // Not a number, ignore (or maybe it's a new command)

  const storedData = pendingSelections.get(chatId);
  // Check if user is the one who searched? Optional, but good practice. 
  // For now, allow anyone in chat to pick to act fast.

  // Validate range
  if (selectionIndex < 1 || selectionIndex > storedData.results.length) {
    return false; // Out of bounds, maybe they meant something else
  }

  const selectedVideo = storedData.results[selectionIndex - 1];

  // Clear selection state
  pendingSelections.delete(chatId);

  // Proceed to download
  try {
    await sock.sendMessage(chatId, { react: { text: '⬇️', key: message.key } });

    const videoInfo = {
      title: selectedVideo.title || selectedVideo.name,
      videoId: selectedVideo.id || selectedVideo.videoId,
      thumbnail: selectedVideo.thumbnail,
      url: `https://youtube.com/watch?v=${selectedVideo.id || selectedVideo.videoId}`
    };

    // Fetch Stream Metadata
    let streamData = null;
    let retryCount = 0;
    const MAX_RETRIES = 2;

    while (retryCount < MAX_RETRIES) {
      try {
        const getRes = await axios.get(`${API_BASE}/get`, {
          params: { ytl: videoInfo.url },
          timeout: 15000
        });

        if (getRes.data) {
          const tracks = getRes.data.tracks;
          if (tracks && tracks.length > 0) {
            streamData = tracks[0];
          } else if (getRes.data.url) {
            streamData = getRes.data;
          }

          if (streamData) {
            if (streamData.title) videoInfo.title = streamData.title;
            if (streamData.thumbnail) videoInfo.thumbnail = streamData.thumbnail;
            break;
          }
        }
      } catch (err) {
        retryCount++;
        if (retryCount >= MAX_RETRIES) throw err;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!streamData || !streamData.url) {
      throw new Error('Failed to extract stream URL');
    }

    // Send "Downloading" status
    await sock.sendMessage(chatId, {
      text: `🎶 *${videoInfo.title}*\n⏳ Downloading stream...`,
      contextInfo: {
        externalAdReply: {
          title: videoInfo.title,
          body: 'Downloading Audio...',
          thumbnailUrl: videoInfo.thumbnail,
          sourceUrl: videoInfo.url,
          mediaType: 1,
          renderLargerThumbnail: true
        }
      }
    }, { quoted: message });

    // Download to Buffer
    const audioStream = await axios({
      method: 'GET',
      url: streamData.url,
      responseType: 'arraybuffer',
      timeout: AXIOS_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': API_BASE
      }
    });

    await sock.sendMessage(chatId, { react: { text: '⬆️', key: message.key } });

    // Send Audio
    await sock.sendMessage(chatId, {
      audio: audioStream.data,
      mimetype: 'audio/mpeg',
      fileName: `${videoInfo.title}.mp3`,
      ptt: false,
      contextInfo: {
        externalAdReply: {
          title: videoInfo.title,
          body: 'Audio Downloaded',
          thumbnailUrl: videoInfo.thumbnail,
          sourceUrl: videoInfo.url,
          mediaType: 1,
          renderLargerThumbnail: true
        }
      }
    }, { quoted: message });

    await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
    return true;

  } catch (err) {
    console.error('Song Selection Error:', err);
    await sock.sendMessage(chatId, {
      text: `❌ Failed to download song. ${err.message}`,
    }, { quoted: message });
    return true; // Handled
  }
}

module.exports = {
  handleSongSelection, // Export for messageHandler
  command: 'song',
  aliases: ['music', 'play', 'mp3'],
  category: 'music',
  description: 'Play music from YouTube (Search & Select)',
  usage: '.song <song name>',

  async handler(sock, message, args, context = {}) {
    const chatId = context.chatId || message.key.remoteJid;
    const query = args.join(' ').trim();

    if (!query) {
      return await sock.sendMessage(chatId, {
        text: '🎵 *Music Player*\n\nUsage:\n.song <song name>'
      }, { quoted: message });
    }

    // If URL, trigger download immediately (bypass selection)
    // Actually, let's reuse handleSelection logic or keep separate?
    // Reuse is cleaner but for now I'll just keep URL handling simple 
    // OR format the URL as a single "result" and auto-select 1?
    // Let's keep URL automatic separation.

    if (query.match(/^https?:\/\//)) {
      // Treat as Direct URL - Mock a "selection" of index 1
      pendingSelections.set(chatId, {
        results: [{
          title: 'Direct Link',
          videoId: 'unknown',
          thumbnail: '',
          url: query,
          id: query.split('v=')[1] || 'unknown'
        }]
      });
      // Auto-trigger selection 1
      return handleSongSelection(sock, chatId, message.key.participant || chatId, '1', message);
    }

    try {
      await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

      const searchRes = await axios.get(`${API_BASE}/api/search/youtube`, {
        params: { query: query },
        timeout: 10000
      });

      // verified path: res.data.results
      const searchResults = searchRes.data?.results;

      if (!searchResults || searchResults.length === 0) {
        return await sock.sendMessage(chatId, { text: '❌ No results found.' }, { quoted: message });
      }

      // Limit to 10 results
      const topResults = searchResults.slice(0, 10);
      pendingSelections.set(chatId, { results: topResults });

      // Build List Message
      let text = `🎶 *Song Search Results*\n\n`;
      topResults.forEach((res, i) => {
        text += `*${i + 1}.* ${res.title || res.name} (${res.duration || res.duration_string})\n`;
      });
      text += `\n_Reply with the number (1-${topResults.length}) to download._`;

      await sock.sendMessage(chatId, {
        text: text,
        contextInfo: {
          externalAdReply: {
            title: `Search: ${query}`,
            body: 'Select a song to download',
            thumbnailUrl: topResults[0].thumbnail,
            mediaType: 1,
            renderLargerThumbnail: true
          }
        }
      }, { quoted: message });

    } catch (err) {
      console.error('Search Error:', err.message);
      await sock.sendMessage(chatId, { text: '❌ Search failed.' }, { quoted: message });
    }
  }
};
