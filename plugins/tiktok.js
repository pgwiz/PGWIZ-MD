const axios = require('axios');
const cheerio = require('cheerio');

const AXIOS_TIMEOUT = 60000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function isValidTikTokUrl(url) {
  if (!url) return false;
  return /(?:tiktok\.com\/|vm\.tiktok\.com\/|vt\.tiktok\.com\/|t\.tiktok\.com\/)/i.test(url);
}

function cleanTikTokUrl(text) {
  const match = text.match(/https?:\/\/(?:[a-zA-Z0-9_-]+\.)?tiktok\.com\/[^\s]+/i);
  return match ? match[0] : null;
}

async function resolveCanonicalUrl(url) {
  try {
    if (/vm\.tiktok\.com|vt\.tiktok\.com|\/t\//i.test(url)) {
      const res = await axios.get(url, {
        maxRedirects: 5,
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENT }
      });
      const finalUrl = res.request?.res?.responseUrl || res.config?.url || url;
      return finalUrl.split('?')[0];
    }
  } catch (e) {
    if (e.response?.headers?.location) {
      return e.response.headers.location.split('?')[0];
    }
  }
  return url;
}

async function fetchTikTokData(rawUrl) {
  const url = await resolveCanonicalUrl(rawUrl);
  let errors = [];

  // 1. Primary Engine: TikWM API (HD No Watermark + MP3 + Photos)
  try {
    const res = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, {
      timeout: 15000,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (res.data?.code === 0 && res.data.data) {
      const d = res.data.data;
      let videoUrl = d.hdplay || d.play || d.wmplay;
      if (videoUrl && !videoUrl.startsWith('http')) videoUrl = 'https://www.tikwm.com' + videoUrl;
      let musicUrl = d.music;
      if (musicUrl && !musicUrl.startsWith('http')) musicUrl = 'https://www.tikwm.com' + musicUrl;

      return {
        title: d.title || 'TikTok Video',
        author: d.author?.nickname || d.author?.unique_id || 'TikTok User',
        username: d.author?.unique_id || '',
        avatar: d.author?.avatar,
        duration: d.duration ? `${d.duration}s` : 'N/A',
        likes: d.digg_count || 0,
        comments: d.comment_count || 0,
        shares: d.share_count || 0,
        views: d.play_count || 0,
        sound: d.music_info?.title || d.music || 'Original Sound',
        videoUrl: videoUrl,
        musicUrl: musicUrl,
        images: Array.isArray(d.images) && d.images.length > 0 ? d.images : null,
        isHD: Boolean(d.hdplay)
      };
    }
  } catch (e1) {
    errors.push(`TikWM: ${e1.message}`);
  }

  // 2. Secondary Engine: SaveTik.co API
  try {
    const res = await axios.post('https://savetik.co/api/ajaxSearch', new URLSearchParams({ q: url, lang: 'en' }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': USER_AGENT,
        'Referer': 'https://savetik.co/en'
      },
      timeout: 15000
    });

    if (res.data && res.data.data) {
      const $ = cheerio.load(res.data.data);
      const title = $('.thumbnail h3').text().trim() || $('h3').text().trim() || 'TikTok Video';
      const author = $('.thumbnail p').text().trim() || 'TikTok Creator';
      let videoUrl = null;
      let hdVideoUrl = null;
      let musicUrl = null;
      let images = [];

      $('a').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().toLowerCase();
        if (href && href.startsWith('http')) {
          if (text.includes('mp4 hd') || text.includes('hd')) {
            hdVideoUrl = href;
          } else if (text.includes('mp4') || text.includes('download')) {
            if (!videoUrl) videoUrl = href;
          } else if (text.includes('mp3') || text.includes('audio')) {
            musicUrl = href;
          }
        }
      });

      $('.photo-list img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src) images.push(src);
      });

      const finalVideo = hdVideoUrl || videoUrl;
      if (finalVideo || images.length > 0) {
        return {
          title: title,
          author: author,
          username: author.replace(/[^a-zA-Z0-9._]/g, ''),
          avatar: null,
          duration: 'N/A',
          likes: 0,
          comments: 0,
          shares: 0,
          views: 0,
          sound: 'Original Sound',
          videoUrl: finalVideo,
          musicUrl: musicUrl,
          images: images.length > 0 ? images : null,
          isHD: Boolean(hdVideoUrl)
        };
      }
    }
  } catch (e2) {
    errors.push(`SaveTik: ${e2.message}`);
  }

  // 3. Fallback Engine: MusicalDown Scraper
  try {
    const sessionRes = await axios.get('https://musicaldown.com/en', {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 12000
    });
    const $ = cheerio.load(sessionRes.data);
    const form = {};
    $('form input').each((_, el) => {
      const name = $(el).attr('name');
      const val = $(el).attr('value') || '';
      if (name) form[name] = val;
    });
    const keys = Object.keys(form);
    if (keys.length >= 2) {
      const postData = new URLSearchParams();
      postData.append(keys[0], url);
      postData.append(keys[1], form[keys[1]]);
      postData.append('verify', '1');

      const cookies = sessionRes.headers['set-cookie']?.map(c => c.split(';')[0]).join('; ');
      const postRes = await axios.post('https://musicaldown.com/download', postData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          'Cookie': cookies,
          'Referer': 'https://musicaldown.com/en'
        },
        timeout: 15000
      });

      const $res = cheerio.load(postRes.data);
      let videoUrl = null;
      let hdVideoUrl = null;
      let musicUrl = null;

      $res('a.btn[href]').each((_, el) => {
        const href = $res(el).attr('href');
        const text = $res(el).text().toLowerCase();
        if (href && href.startsWith('http')) {
          if (text.includes('hd')) hdVideoUrl = href;
          else if (text.includes('mp4')) {
            if (!videoUrl) videoUrl = href;
          } else if (text.includes('mp3')) musicUrl = href;
        }
      });

      const finalVideo = hdVideoUrl || videoUrl;
      if (finalVideo) {
        return {
          title: 'TikTok Video',
          author: 'TikTok Creator',
          username: '',
          avatar: null,
          duration: 'N/A',
          likes: 0,
          comments: 0,
          shares: 0,
          views: 0,
          sound: 'Original Sound',
          videoUrl: finalVideo,
          musicUrl: musicUrl,
          images: null,
          isHD: Boolean(hdVideoUrl)
        };
      }
    }
  } catch (e3) {
    errors.push(`MusicalDown: ${e3.message}`);
  }

  throw new Error(`Failed to extract TikTok media from all providers: ${errors.join(' | ')}`);
}

module.exports = {
  command: 'tiktok',
  aliases: ['tt', 'ttdl', 'tiktokdl', 'tiktoknowm'],
  category: 'download',
  description: 'Download TikTok video (HD No Watermark), photo slides, or audio',
  usage: '.tiktok <TikTok URL> [mp3/audio]',

  async handler(sock, message, args, context = {}) {
    const chatId = context.chatId || message.key.remoteJid;
    const rawInput = args.join(' ').trim();
    const url = cleanTikTokUrl(rawInput);

    if (!url || !isValidTikTokUrl(url)) {
      return await sock.sendMessage(chatId, {
        text: '🎵 *TikTok Downloader (HD No Watermark)*\n\n' +
          '*Usage:*\n' +
          '• `.tiktok <TikTok link>` - Download Video or Photo Slide\n' +
          '• `.tiktok <TikTok link> audio` - Extract Audio only\n\n' +
          '*Example:*\n' +
          '`.tiktok https://vm.tiktok.com/ZMxxxxxx/`'
      }, { quoted: message });
    }

    const wantAudioOnly = rawInput.toLowerCase().includes('mp3') || rawInput.toLowerCase().includes('audio') || rawInput.toLowerCase().includes('sound');

    try {
      await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

      const data = await fetchTikTokData(url);

      // 1. Audio-only mode
      if (wantAudioOnly && data.musicUrl) {
        await sock.sendMessage(chatId, {
          text: `🎧 *${data.title}*\n⏳ Downloading audio track...`
        }, { quoted: message });

        const audioRes = await axios.get(data.musicUrl, {
          responseType: 'arraybuffer',
          timeout: AXIOS_TIMEOUT,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        await sock.sendMessage(chatId, {
          audio: audioRes.data,
          mimetype: 'audio/mpeg',
          fileName: `${data.title}.mp3`,
          contextInfo: {
            externalAdReply: {
              title: data.title,
              body: `Sound: ${data.sound} • By ${data.author}`,
              thumbnailUrl: data.avatar,
              sourceUrl: url,
              mediaType: 1,
              renderLargerThumbnail: true
            }
          }
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        return;
      }

      // 2. Photo Slideshow mode
      if (data.images && data.images.length > 0) {
        await sock.sendMessage(chatId, {
          text: `📸 *TikTok Photo Slide Detected*\nSending ${data.images.length} photos...`
        }, { quoted: message });

        for (let i = 0; i < data.images.length; i++) {
          const imgUrl = typeof data.images[i] === 'string' ? data.images[i] : data.images[i].url;
          if (imgUrl) {
            await sock.sendMessage(chatId, {
              image: { url: imgUrl },
              caption: i === 0 ? `📝 *${data.title}*\n👤 *Author:* ${data.author}` : undefined
            });
            await new Promise(r => setTimeout(r, 600));
          }
        }

        // Also send background music
        if (data.musicUrl) {
          await sock.sendMessage(chatId, {
            audio: { url: data.musicUrl },
            mimetype: 'audio/mpeg',
            fileName: 'sound.mp3'
          });
        }

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        return;
      }

      // 3. HD Video mode
      if (!data.videoUrl) {
        throw new Error('No downloadable video stream found');
      }

      const caption =
`🎵 *TikTok Downloader*
━━━━━━━━━━━━━━━━━━━
👤 *Author:* ${data.author} (@${data.username})
⏱️ *Duration:* ${data.duration}
❤️ *Likes:* ${Number(data.likes).toLocaleString()}
💬 *Comments:* ${Number(data.comments).toLocaleString()}
🔁 *Shares:* ${Number(data.shares).toLocaleString()}
👀 *Views:* ${Number(data.views).toLocaleString()}

🎧 *Sound:* ${data.sound}

📝 *Caption:*
${data.title || 'No caption'}

✨ *Quality:* ${data.isHD ? 'HD No Watermark' : 'No Watermark'}
━━━━━━━━━━━━━━━━━━━
> *Downloaded via MEGA-MD*`;

      const videoRes = await axios.get(data.videoUrl, {
        responseType: 'arraybuffer',
        timeout: AXIOS_TIMEOUT,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      await sock.sendMessage(chatId, {
        video: videoRes.data,
        mimetype: 'video/mp4',
        fileName: `${data.author}_tiktok.mp4`,
        caption: caption
      }, { quoted: message });

      await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (error) {
      console.error('TikTok downloader error:', error);
      await sock.sendMessage(chatId, {
        text: `❌ *Failed to download TikTok video!*\n\nReason: ${error.message || 'Service unavailable'}\n\nPlease verify the link and try again.`
      }, { quoted: message });
    }
  }
};
