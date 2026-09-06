const axios = require('axios');

const API_BASE = 'https://ytsp-api.pgwiz.cloud';
const AXIOS_TIMEOUT = 60000;

function cleanFileName(str) {
  return (str || 'track').replace(/[\\/:*?"<>|]/g, '').trim();
}

module.exports = {
  command: 'spotify',
  aliases: ['sp', 'spotifydl', 'spot'],
  category: 'download',
  description: 'Play and download songs, albums, or playlists from Spotify (Keyless)',
  usage: '.spotify <song name | spotify track / playlist / album url>',

  async handler(sock, message, args, context = {}) {
    const chatId = context.chatId || message.key.remoteJid;
    const rawQuery = args.join(' ').trim();

    if (!rawQuery) {
      return await sock.sendMessage(chatId, {
        text: '🟢 *Spotify Downloader*\n\nUsage:\n• `.spotify <song/artist/keywords>` (e.g. `.spotify blinding lights`)\n• `.spotify <spotify track link>`\n• `.spotify <spotify playlist/album link>`'
      }, { quoted: message });
    }

    try {
      await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

      const isSpotifyUrl = /^https?:\/\/(open\.)?spotify\.com\//i.test(rawQuery);
      let targetUrl = rawQuery;
      let trackMeta = null;

      // 1. If text search query, find via Spotify search endpoint
      if (!isSpotifyUrl) {
        try {
          const searchRes = await axios.get(`${API_BASE}/api/search/spotify`, {
            params: { query: rawQuery, limit: 5 },
            timeout: 12000
          });
          const results = searchRes.data?.results || [];
          if (results.length > 0) {
            const top = results[0];
            trackMeta = {
              title: top.title || top.name,
              artist: top.artist,
              thumbnail: top.thumbnail,
              duration: top.duration,
              url: top.spotifyUrl || top.url
            };
            if (top.spotifyUrl) {
              targetUrl = top.spotifyUrl;
            } else if (top.videoId) {
              targetUrl = `https://www.youtube.com/watch?v=${top.videoId}`;
            }
          }
        } catch (sErr) {
          console.error('[Spotify Search API Error]:', sErr.message);
        }
      }

      // 2. Fetch media stream and metadata from YTSP API
      const getRes = await axios.get(`${API_BASE}/get`, {
        params: { ytl: targetUrl, quality: 'audio' },
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      const data = getRes.data;
      if (!data) {
        throw new Error('Could not retrieve song details from media server.');
      }

      // Handle Playlist / Album metadata display
      if (data.is_playlist) {
        const playlistTitle = data.playlist_name || data.title || 'Spotify Playlist';
        const tracks = data.tracks || [];
        let listText = `🟢 *Spotify Playlist / Album*\n💿 *${playlistTitle}*\n🔢 Total Tracks: ${data.total_tracks || tracks.length}\n\n`;
        
        tracks.slice(0, 15).forEach((t, i) => {
          listText += `*${i + 1}.* ${t.title || t.name} - ${t.artist || 'Unknown'} (${t.duration || t.duration_string || 'N/A'})\n`;
        });
        
        if (tracks.length > 15) {
          listText += `\n_...and ${tracks.length - 15} more tracks._\n`;
        }
        listText += `\n> *To download a specific track, use:* \`.spotify <track name>\``;

        return await sock.sendMessage(chatId, {
          text: listText,
          contextInfo: {
            externalAdReply: {
              title: playlistTitle,
              body: `Spotify Collection • ${tracks.length} tracks`,
              thumbnailUrl: tracks[0]?.thumbnail || 'https://open.spotify.com/favicon.ico',
              sourceUrl: targetUrl,
              mediaType: 1,
              renderLargerThumbnail: true
            }
          }
        }, { quoted: message });
      }

      // Single Track Resolution
      const finalTitle = data.title || trackMeta?.title || 'Spotify Track';
      const finalArtist = data.artist || data.uploader || trackMeta?.artist || 'Spotify Artist';
      const finalDuration = data.duration || trackMeta?.duration || '3:30';
      const finalThumbnail = data.thumbnail || trackMeta?.thumbnail || '';
      let proxyUrl = data.proxy_url || data.streamUrl || data.url;

      if (!proxyUrl) {
        throw new Error('No streaming audio URL available for this track.');
      }
      if (!proxyUrl.startsWith('http')) {
        proxyUrl = `${API_BASE}${proxyUrl}`;
      }

      // Notify downloading
      await sock.sendMessage(chatId, {
        text: `🟢 *${finalTitle}*\n👤 *Artist:* ${finalArtist}\n⏱️ *Duration:* ${finalDuration}\n⏳ _Downloading high quality MP3..._`,
        contextInfo: {
          externalAdReply: {
            title: finalTitle,
            body: `${finalArtist} • ${finalDuration}`,
            thumbnailUrl: finalThumbnail,
            sourceUrl: isSpotifyUrl ? targetUrl : (data.videoId ? `https://youtube.com/watch?v=${data.videoId}` : API_BASE),
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

      const fileName = `${cleanFileName(finalTitle)} - ${cleanFileName(finalArtist)}.mp3`;

      // 1. Send as Playable Audio Stream
      await sock.sendMessage(chatId, {
        audio: audioBuffer.data,
        mimetype: 'audio/mpeg',
        fileName: fileName,
        contextInfo: {
          externalAdReply: {
            title: finalTitle,
            body: `Spotify • ${finalArtist}`,
            thumbnailUrl: finalThumbnail,
            sourceUrl: isSpotifyUrl ? targetUrl : `https://open.spotify.com`,
            mediaType: 1,
            renderLargerThumbnail: true
          }
        }
      }, { quoted: message });

      // 2. Send as Downloadable Document File
      await sock.sendMessage(chatId, {
        document: audioBuffer.data,
        mimetype: 'audio/mpeg',
        fileName: fileName,
        contextInfo: {
          externalAdReply: {
            title: finalTitle,
            body: 'Spotify MP3 Download',
            thumbnailUrl: finalThumbnail,
            sourceUrl: isSpotifyUrl ? targetUrl : `https://open.spotify.com`,
            mediaType: 1,
            renderLargerThumbnail: true
          }
        }
      }, { quoted: message });

      await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
      console.error('[Spotify Handler Error]:', err.message);
      await sock.sendMessage(chatId, {
        text: `❌ *Spotify Download Failed!*\n\nReason: ${err.message || 'Service unavailable'}\n\nPlease verify your link or query and try again.`
      }, { quoted: message });
    }
  }
};
