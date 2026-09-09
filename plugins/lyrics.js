const axios = require('axios');
const settings = require('../settings');

const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: settings.newsletterJid || '120363179639202475@newsletter',
            newsletterName: settings.newsletterName || settings.botName || 'PGWIZ-MD',
            serverMessageId: -1
        }
    }
};

module.exports = {
    command: 'lyrics',
    aliases: ['lyric', 'songlyrics', 'lrc'],
    category: 'music',
    description: 'Search and get full song lyrics with HD cover art and artist details',
    usage: '.lyrics <song name or artist - title>',

    async handler(sock, message, args, context = {}) {
        const chatId = context.chatId || message.key.remoteJid;
        const songTitle = args.join(' ').trim();

        if (!songTitle) {
            return await sock.sendMessage(chatId, {
                text: '🎵 *Please provide a song title to search lyrics!*\n\n*Usage:* `.lyrics <song name>`\n*Example:* `.lyrics Adele Hello`',
                ...channelInfo
            }, { quoted: message });
        }

        try {
            await sock.sendMessage(chatId, {
                react: { text: '🔍', key: message.key }
            }).catch(() => {});

            let lyricsData = null;
            let artworkUrl = null;
            let trackName = songTitle;
            let artistName = '';
            let albumName = '';
            let releaseDate = '';

            // 1. Fetch artwork and track metadata from iTunes
            try {
                const itunesRes = await axios.get('https://itunes.apple.com/search?term=' + encodeURIComponent(songTitle) + '&limit=1&entity=song', {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                    timeout: 7000
                });
                if (itunesRes.status === 200 && itunesRes.data?.results?.length > 0) {
                    const item = itunesRes.data.results[0];
                    trackName = item.trackName || trackName;
                    artistName = item.artistName || '';
                    albumName = item.collectionName || '';
                    releaseDate = item.releaseDate ? item.releaseDate.substring(0, 10) : '';
                    if (item.artworkUrl100) {
                        artworkUrl = item.artworkUrl100.replace('100x100bb', '600x600bb');
                    }
                }
            } catch (itunesErr) {
                // Silently fallback
            }

            // 2. Fetch lyrics from LRCLIB
            try {
                const query = artistName ? `${artistName} ${trackName}` : songTitle;
                const lrcRes = await axios.get('https://lrclib.net/api/search?q=' + encodeURIComponent(query), {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                    timeout: 9000
                });
                if (lrcRes.status === 200 && Array.isArray(lrcRes.data) && lrcRes.data.length > 0) {
                    const match = lrcRes.data.find(s => s.plainLyrics) || lrcRes.data[0];
                    if (match && (match.plainLyrics || match.syncedLyrics)) {
                        lyricsData = {
                            lyrics: match.plainLyrics || match.syncedLyrics.replace(/\[\d+:\d+\.\d+\]/g, '').trim(),
                            trackName: match.trackName || trackName,
                            artistName: match.artistName || artistName,
                            albumName: match.albumName || albumName
                        };
                    }
                }
            } catch (lrcErr) {
                // Silently fallback
            }

            // 3. Fallback: lyrics.ovh
            if (!lyricsData && artistName && trackName) {
                try {
                    const ovhRes = await axios.get('https://api.lyrics.ovh/v1/' + encodeURIComponent(artistName) + '/' + encodeURIComponent(trackName), {
                        headers: { 'User-Agent': 'Mozilla/5.0' },
                        timeout: 7000
                    });
                    if (ovhRes.status === 200 && ovhRes.data?.lyrics) {
                        lyricsData = {
                            lyrics: ovhRes.data.lyrics.trim(),
                            trackName,
                            artistName,
                            albumName
                        };
                    }
                } catch (ovhErr) {
                    // Silently fallback
                }
            }

            if (!lyricsData || !lyricsData.lyrics) {
                await sock.sendMessage(chatId, {
                    react: { text: '❌', key: message.key }
                }).catch(() => {});

                return await sock.sendMessage(chatId, {
                    text: `❌ *Lyrics Not Found*\n\nSorry, could not locate lyrics for "*${songTitle}*". Please try searching with artist and song title (e.g. \`.lyrics ${artistName || 'Artist'} - ${trackName || 'Title'}\`).`,
                    ...channelInfo
                }, { quoted: message });
            }

            const maxChars = 4000;
            const fullLyrics = lyricsData.lyrics.length > maxChars
                ? lyricsData.lyrics.slice(0, maxChars - 20) + '\n\n... [Lyrics Truncated]'
                : lyricsData.lyrics;

            const displayTitle = lyricsData.trackName || trackName;
            const displayArtist = lyricsData.artistName || artistName || 'Unknown Artist';
            const displayAlbum = lyricsData.albumName || albumName;

            let metaBlock = `🎵 *${displayTitle}*\n👤 *Artist:* ${displayArtist}`;
            if (displayAlbum) metaBlock += `\n💿 *Album:* ${displayAlbum}`;
            if (releaseDate) metaBlock += `\n📅 *Release:* ${releaseDate}`;

            const caption = `${metaBlock}\n\n📝 *Lyrics:*\n\`\`\`\n${fullLyrics}\n\`\`\`\n\n> _Powered by PGWIZ-MD Music Engine_`;

            await sock.sendMessage(chatId, {
                react: { text: '🎶', key: message.key }
            }).catch(() => {});

            if (artworkUrl) {
                return await sock.sendMessage(chatId, {
                    image: { url: artworkUrl },
                    caption: caption,
                    ...channelInfo
                }, { quoted: message });
            } else {
                return await sock.sendMessage(chatId, {
                    text: caption,
                    ...channelInfo
                }, { quoted: message });
            }

        } catch (error) {
            console.error('[LYRICS] Error fetching lyrics:', error);
            await sock.sendMessage(chatId, {
                text: `❌ *Error fetching lyrics for "${songTitle}":* ${error.message || error}`,
                ...channelInfo
            }, { quoted: message });
        }
    }
};
