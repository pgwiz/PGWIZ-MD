const axios = require('axios');
let yts;
try { yts = require('yt-search'); } catch { try { yts = require('youtube-yts'); } catch {} }

const API_BASE = 'https://ytsp-api.pgwiz.cloud';
const AXIOS_TIMEOUT = 60000;

function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/))([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

module.exports = {
  command: 'play',
  aliases: ['plays', 'music', 'ytplay'],
  category: 'music',
  description: 'Instantly play any song from YouTube or Spotify',
  usage: '.play <song name | youtube / spotify link>',

  async handler(sock, message, args, context = {}) {
    const chatId = context.chatId || message.key.remoteJid;
    const query = args.join(' ').trim();

    if (!query) {
      return await sock.sendMessage(chatId, {
        text: '🎵 *Instant Music Player*\n\nUsage:\n• `.play <song name>` (e.g. `.play i feel it coming`)\n• `.play <youtube or spotify link>`'
      }, { quoted: message });
    }

    try {
      await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

      let targetVideoId = null;
      let targetTitle = '';
      let targetThumbnail = '';
      let targetDuration = 'N/A';
      let targetUploader = '';
      let directUrl = '';

      if (query.match(/^https?:\/\//i)) {
        directUrl = query;
        targetVideoId = extractYouTubeId(query);
      } else {
        // Search using yt-search
        if (yts) {
          try {
            const res = await yts(query);
            if (res && res.videos && res.videos.length > 0) {
              const top = res.videos[0];
              targetVideoId = top.videoId;
              targetTitle = top.title;
              targetThumbnail = top.thumbnail;
              targetDuration = top.timestamp || top.duration?.toString();
              targetUploader = top.author?.name || '';
              directUrl = top.url;
            }
          } catch {}
        }

        // Fallback to YTSP Search API
        if (!targetVideoId) {
          const searchRes = await axios.get(`${API_BASE}/api/search/youtube`, {
            params: { query: query, limit: 1 },
            timeout: 10000
          });
          const top = searchRes.data?.results?.[0];
          if (top) {
            targetVideoId = top.id || top.videoId;
            targetTitle = top.title || top.name;
            targetThumbnail = top.thumbnail;
            targetDuration = top.duration || top.duration_string;
            directUrl = top.url;
          }
        }
      }

      if (!targetVideoId && !directUrl) {
        return await sock.sendMessage(chatId, {
          text: '❌ *No song found!* Please try a different title.'
        }, { quoted: message });
      }

      // Fetch audio stream metadata from YTSP
      let streamMeta = null;
      if (targetVideoId && !directUrl.includes('spotify.com')) {
        try {
          const res = await axios.get(`${API_BASE}/stream/${targetVideoId}`, {
            params: { quality: 'audio' },
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          if (res.data) streamMeta = res.data;
        } catch {}
      }

      if (!streamMeta && directUrl) {
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
              if (tId && !directUrl.includes('spotify.com')) {
                const sRes = await axios.get(`${API_BASE}/stream/${tId}`, {
                  params: { quality: 'audio' },
                  timeout: 15000
                });
                if (sRes.data) streamMeta = sRes.data;
              } else {
                streamMeta = track;
              }
            } else {
              streamMeta = res.data;
            }
          }
        } catch {}
      }

      if (!streamMeta) {
        throw new Error('Could not extract stream from media server');
      }

      const finalTitle = streamMeta.title || targetTitle || 'Playing Track';
      const finalThumbnail = streamMeta.thumbnail || targetThumbnail || (targetVideoId ? `https://img.youtube.com/vi/${targetVideoId}/mqdefault.jpg` : '');
      const finalUploader = streamMeta.uploader || streamMeta.artist || targetUploader || 'Artist';
      const finalDuration = streamMeta.duration || streamMeta.duration_string || targetDuration;
      let proxyUrl = streamMeta.proxy_url || streamMeta.streamUrl || streamMeta.url;

      if (!proxyUrl) {
        throw new Error('No audio stream link available');
      }
      if (!proxyUrl.startsWith('http')) proxyUrl = `${API_BASE}${proxyUrl}`;

      // Notify downloading
      await sock.sendMessage(chatId, {
        text: `🎵 *${finalTitle}*\n⏳ Downloading audio stream...`,
        contextInfo: {
          externalAdReply: {
            title: finalTitle,
            body: `${finalUploader} • ${finalDuration}`,
            thumbnailUrl: finalThumbnail,
            sourceUrl: directUrl || (targetVideoId ? `https://youtube.com/watch?v=${targetVideoId}` : API_BASE),
            mediaType: 1,
            renderLargerThumbnail: true
          }
        }
      }, { quoted: message });

      await sock.sendMessage(chatId, { react: { text: '⬇️', key: message.key } });

      const audioBuffer = await axios.get(proxyUrl, {
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
        audio: audioBuffer.data,
        mimetype: 'audio/mpeg',
        fileName: `${finalTitle}.mp3`,
        contextInfo: {
          externalAdReply: {
            title: finalTitle,
            body: `Now Playing • ${finalDuration}`,
            thumbnailUrl: finalThumbnail,
            sourceUrl: directUrl || `https://youtube.com/watch?v=${targetVideoId}`,
            mediaType: 1,
            renderLargerThumbnail: true
          }
        }
      }, { quoted: message });

      await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (error) {
      console.error('Play command error:', error);
      await sock.sendMessage(chatId, {
        text: `❌ *Download failed!*\n\nReason: ${error.message || 'Service temporarily unavailable'}\n\nPlease try again shortly.`
      }, { quoted: message });
    }
  }
};
