const axios = require('axios');
const fs = require('fs');
let yts;
try { yts = require('yt-search'); } catch { try { yts = require('youtube-yts'); } catch {} }

const API_BASE = 'https://ytsp-api.pgwiz.cloud';
const AXIOS_TIMEOUT = 60000;

// Store pending searches: chatId -> [results]
global.songSelections = global.songSelections || new Map();
const pendingSelections = global.songSelections;

if (!global.songSelectionCleaner) {
  global.songSelectionCleaner = setInterval(() => pendingSelections.clear(), 3600000);
}

function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/))([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

async function fetchAudioStream(videoId, directUrl = '') {
  let streamData = null;
  let errorMsg = '';

  // 1. Try YTSP stream/:videoId endpoint
  if (videoId && videoId !== 'unknown' && !videoId.includes('spotify.com')) {
    try {
      const res = await axios.get(`${API_BASE}/stream/${videoId}`, {
        params: { quality: 'audio' },
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.data) {
        streamData = res.data;
      }
    } catch (e) {
      errorMsg = e.message;
    }
  }

  // 2. Try YTSP /get endpoint with URL (supports YouTube & Spotify URLs)
  if ((!streamData || !streamData.proxy_url) && directUrl) {
    try {
      const res = await axios.get(`${API_BASE}/get`, {
        params: { ytl: directUrl, quality: 'audio' },
        timeout: 25000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.data) {
        if (res.data.tracks && res.data.tracks.length > 0) {
          const track = res.data.tracks[0];
          const tId = track.videoId || track.id;
          if (tId && !directUrl.includes('spotify.com')) return await fetchAudioStream(tId, track.url);
          streamData = track;
        } else {
          streamData = res.data;
        }
      }
    } catch (e) {
      errorMsg = e.message;
    }
  }

  if (streamData) {
    let proxyUrl = streamData.proxy_url || streamData.streamUrl || streamData.url;
    if (proxyUrl) {
      if (!proxyUrl.startsWith('http')) proxyUrl = `${API_BASE}${proxyUrl}`;
      return {
        title: streamData.title || streamData.name || 'Audio',
        uploader: streamData.uploader || streamData.artist || 'Artist',
        duration: streamData.duration || streamData.duration_string || 'N/A',
        thumbnail: streamData.thumbnail || (videoId && videoId !== 'unknown' ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : ''),
        downloadUrl: proxyUrl,
        videoId: videoId || streamData.videoId
      };
    }
  }

  throw new Error(`Could not extract audio stream (${errorMsg || 'API offline'})`);
}

async function handleSongSelection(sock, chatId, senderId, text, message) {
  if (!pendingSelections.has(chatId)) return false;

  const selectionIndex = parseInt(text.trim());
  if (isNaN(selectionIndex)) return false;

  const storedData = pendingSelections.get(chatId);
  if (selectionIndex < 1 || selectionIndex > storedData.results.length) return false;

  const selectedVideo = storedData.results[selectionIndex - 1];
  pendingSelections.delete(chatId);

  try {
    await sock.sendMessage(chatId, { react: { text: '⬇️', key: message.key } });

    const videoId = selectedVideo.id || selectedVideo.videoId || extractYouTubeId(selectedVideo.url);
    const videoUrl = selectedVideo.url || (videoId ? `https://youtube.com/watch?v=${videoId}` : '');

    const streamInfo = await fetchAudioStream(videoId, videoUrl);
    const title = streamInfo.title || selectedVideo.title || 'Song';
    const thumbnail = streamInfo.thumbnail || selectedVideo.thumbnail;

    await sock.sendMessage(chatId, {
      text: `🎶 *${title}*\n⏳ Downloading audio...`,
      contextInfo: {
        externalAdReply: {
          title: title,
          body: `By ${streamInfo.uploader || 'Artist'} • ${streamInfo.duration}`,
          thumbnailUrl: thumbnail,
          sourceUrl: videoUrl,
          mediaType: 1,
          renderLargerThumbnail: true
        }
      }
    }, { quoted: message });

    const audioRes = await axios.get(streamInfo.downloadUrl, {
      responseType: 'arraybuffer',
      timeout: AXIOS_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': API_BASE
      }
    });

    await sock.sendMessage(chatId, { react: { text: '⬆️', key: message.key } });

    // Send as playable audio
    await sock.sendMessage(chatId, {
      audio: audioRes.data,
      mimetype: 'audio/mpeg',
      fileName: `${title}.mp3`,
      contextInfo: {
        externalAdReply: {
          title: title,
          body: `Playing: ${title}`,
          thumbnailUrl: thumbnail,
          sourceUrl: videoUrl,
          mediaType: 1,
          renderLargerThumbnail: true
        }
      }
    }, { quoted: message });

    // Send as document MP3
    await sock.sendMessage(chatId, {
      document: audioRes.data,
      mimetype: 'audio/mpeg',
      fileName: `${title}.mp3`,
      contextInfo: {
        externalAdReply: {
          title: title,
          body: 'Audio File Downloaded',
          thumbnailUrl: thumbnail,
          sourceUrl: videoUrl,
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
      text: `❌ Failed to download song: ${err.message}`,
    }, { quoted: message });
    return true;
  }
}

module.exports = {
  handleSongSelection,
  command: 'song',
  aliases: ['mp3', 'songdoc'],
  category: 'music',
  description: 'Download music from YouTube or Spotify by search or direct URL',
  usage: '.song <song name | youtube / spotify link>',

  async handler(sock, message, args, context = {}) {
    const chatId = context.chatId || message.key.remoteJid;
    const query = args.join(' ').trim();

    if (!query) {
      return await sock.sendMessage(chatId, {
        text: '🎵 *Music Downloader*\n\nUsage:\n• `.song <song name>` (Search list)\n• `.song <youtube or spotify link>` (Direct download)'
      }, { quoted: message });
    }

    // Direct YouTube / Spotify Link Handling
    if (query.match(/^https?:\/\//i)) {
      const isSpotify = query.includes('spotify.com');
      const vId = extractYouTubeId(query) || (isSpotify ? 'spotify' : 'unknown');
      pendingSelections.set(chatId, {
        results: [{
          title: isSpotify ? 'Spotify Track' : 'Direct Link Track',
          videoId: vId,
          id: vId,
          thumbnail: vId !== 'unknown' && vId !== 'spotify' ? `https://img.youtube.com/vi/${vId}/mqdefault.jpg` : '',
          url: query
        }]
      });
      return handleSongSelection(sock, chatId, message.key.participant || chatId, '1', message);
    }

    // Search Mode
    try {
      await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

      let topResults = [];

      // 1. Try local yt-search
      if (yts) {
        try {
          const searchRes = await yts(query);
          if (searchRes && searchRes.videos && searchRes.videos.length > 0) {
            topResults = searchRes.videos.slice(0, 10).map(v => ({
              id: v.videoId,
              videoId: v.videoId,
              title: v.title,
              name: v.title,
              duration: v.timestamp || v.duration?.toString(),
              duration_string: v.timestamp,
              thumbnail: v.thumbnail,
              url: v.url,
              author: v.author?.name
            }));
          }
        } catch {}
      }

      // 2. Fallback to YTSP API search
      if (topResults.length === 0) {
        const searchRes = await axios.get(`${API_BASE}/api/search/youtube`, {
          params: { query: query, limit: 10 },
          timeout: 12000
        });
        topResults = searchRes.data?.results || [];
      }

      if (topResults.length === 0) {
        return await sock.sendMessage(chatId, { text: '❌ No songs found for your query.' }, { quoted: message });
      }

      pendingSelections.set(chatId, { results: topResults });

      let text = `🎶 *Song Search Results*\n\n`;
      topResults.forEach((res, i) => {
        text += `*${i + 1}.* ${res.title || res.name} (${res.duration || res.duration_string || 'N/A'})\n`;
      });
      text += `\n_Reply with a number (1-${topResults.length}) to download._`;

      await sock.sendMessage(chatId, {
        text: text,
        contextInfo: {
          externalAdReply: {
            title: `Search: ${query}`,
            body: 'Select a number to download audio',
            thumbnailUrl: topResults[0].thumbnail,
            mediaType: 1,
            renderLargerThumbnail: true
          }
        }
      }, { quoted: message });

    } catch (err) {
      console.error('Song search error:', err.message);
      await sock.sendMessage(chatId, { text: `❌ Search failed: ${err.message}` }, { quoted: message });
    }
  }
};
