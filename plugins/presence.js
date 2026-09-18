const fs = require('fs');
const path = require('path');
const store = require('../lib/lightweight_store');
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

// Global active presence subscriptions tracker
if (!global.presenceSubscriptions) {
    global.presenceSubscriptions = new Map();
}

async function getPresenceConfig() {
    try {
        const config = await store.getSetting('global', 'presenceSettings');
        if (config) return config;
    } catch {}
    return {
        mode: process.env.PRESENCE_MODE || 'available',
        autoPresence: process.env.AUTO_PRESENCE || 'off', // 'typing', 'recording', 'online', 'off'
        alwaysOnline: process.env.ALWAYS_ONLINE === 'true'
    };
}

async function savePresenceConfig(config) {
    try {
        process.env.PRESENCE_MODE = config.mode || 'available';
        process.env.AUTO_PRESENCE = config.autoPresence || 'off';
        await store.saveSetting('global', 'presenceSettings', config);
    } catch (e) {
        console.error('[PRESENCE] Error saving config:', e.message);
    }
}

// Sustained presence interval map (chatId -> timer)
const sustainedTimers = new Map();

async function sendPresence(sock, type, jid = null, sustainedSec = 0) {
    if (!sock) return;
    try {
        if (jid) {
            await sock.sendPresenceUpdate(type, jid);
        } else {
            await sock.sendPresenceUpdate(type);
        }

        // Handle sustained presence (> 10s expiration in WhatsApp)
        if (jid && sustainedSec > 10 && (type === 'composing' || type === 'recording')) {
            if (sustainedTimers.has(jid)) {
                clearInterval(sustainedTimers.get(jid));
            }
            const endTime = Date.now() + (sustainedSec * 1000);
            const interval = setInterval(async () => {
                if (Date.now() >= endTime) {
                    clearInterval(interval);
                    sustainedTimers.delete(jid);
                    await sock.sendPresenceUpdate('paused', jid).catch(() => {});
                } else {
                    await sock.sendPresenceUpdate(type, jid).catch(() => {});
                }
            }, 7000);
            sustainedTimers.set(jid, interval);
        }
    } catch (e) {
        console.error('[PRESENCE] Error sending presence update:', e.message);
    }
}

module.exports = {
    command: 'presence',
    aliases: ['pres', 'setpresence', 'statuspresence'],
    category: 'owner',
    description: 'Manage WhatsApp presence (available, unavailable, typing, recording, subscribe)',
    usage: '.presence <available|unavailable|composing|recording|paused|auto <mode>|subscribe <num>|check <num>>',
    ownerOnly: true,

    async handler(sock, message, args, context = {}) {
        const chatId = context.chatId || message.key.remoteJid;
        const config = await getPresenceConfig();

        if (!args || args.length === 0 || args[0].toLowerCase() === 'list' || args[0].toLowerCase() === 'status') {
            const text = `🟢 *PGWIZ Presence Management*\n\n` +
                `🔹 *Current State:* \`${config.mode || 'available'}\`\n` +
                `🔹 *Auto Presence:* \`${config.autoPresence || 'off'}\`\n` +
                `🔹 *Active Subscriptions:* \`${global.presenceSubscriptions.size}\`\n\n` +
                `*Commands:*\n` +
                `• \`.presence available\` - Broadcast online status\n` +
                `• \`.presence unavailable\` - Broadcast offline status\n` +
                `• \`.presence composing\` (or \`typing\`) - Show typing... indicator\n` +
                `• \`.presence recording\` (or \`audio\`) - Show recording audio... indicator\n` +
                `• \`.presence paused\` (or \`stop\`) - Stop typing/recording indicator\n` +
                `• \`.presence auto <typing|recording|online|off>\` - Set automatic activity\n` +
                `• \`.presence subscribe <num>\` - Subscribe to contact's live status\n` +
                `• \`.presence check <num>\` - Check contact's current presence\n\n` +
                `_💡 Sustained typing indicators automatically refresh every 7s to beat WhatsApp 10s expiry._`;

            await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
            return;
        }

        const action = args[0].toLowerCase();

        // 1. Available / Online
        if (action === 'available' || action === 'online') {
            config.mode = 'available';
            await savePresenceConfig(config);
            await sendPresence(sock, 'available');
            await sock.sendMessage(chatId, {
                text: '✅ *Presence set to AVAILABLE (Online)!*',
                ...channelInfo
            }, { quoted: message });
            return;
        }

        // 2. Unavailable / Offline
        if (action === 'unavailable' || action === 'offline') {
            config.mode = 'unavailable';
            await savePresenceConfig(config);
            await sendPresence(sock, 'unavailable');
            await sock.sendMessage(chatId, {
                text: '💤 *Presence set to UNAVAILABLE (Offline)!*\n_Phone will now receive direct push notifications without desktop suppression._',
                ...channelInfo
            }, { quoted: message });
            return;
        }

        // 3. Composing / Typing
        if (action === 'composing' || action === 'typing') {
            const duration = parseInt(args[1]) || 15; // default 15s sustained
            await sendPresence(sock, 'composing', chatId, duration);
            await sock.sendMessage(chatId, {
                text: `⌨️ *Presence set to COMPOSING (Typing...)* for ${duration}s!`,
                ...channelInfo
            }, { quoted: message });
            return;
        }

        // 4. Recording / Audio
        if (action === 'recording' || action === 'audio') {
            const duration = parseInt(args[1]) || 15; // default 15s sustained
            await sendPresence(sock, 'recording', chatId, duration);
            await sock.sendMessage(chatId, {
                text: `🎙️ *Presence set to RECORDING (Recording Audio...)* for ${duration}s!`,
                ...channelInfo
            }, { quoted: message });
            return;
        }

        // 5. Paused / Stop
        if (action === 'paused' || action === 'stop') {
            if (sustainedTimers.has(chatId)) {
                clearInterval(sustainedTimers.get(chatId));
                sustainedTimers.delete(chatId);
            }
            await sendPresence(sock, 'paused', chatId);
            await sock.sendMessage(chatId, {
                text: '⏹️ *Presence indicator PAUSED.*',
                ...channelInfo
            }, { quoted: message });
            return;
        }

        // 6. Auto-Presence Mode
        if (action === 'auto') {
            const mode = (args[1] || '').toLowerCase();
            if (!['typing', 'recording', 'online', 'off'].includes(mode)) {
                await sock.sendMessage(chatId, {
                    text: '❌ *Usage:* `.presence auto <typing|recording|online|off>`',
                    ...channelInfo
                }, { quoted: message });
                return;
            }
            config.autoPresence = mode;
            await savePresenceConfig(config);
            await sock.sendMessage(chatId, {
                text: `⚡ *Auto-Presence updated to:* \`${mode}\`\n_Applied lively in runtime memory._`,
                ...channelInfo
            }, { quoted: message });
            return;
        }

        // 7. Subscribe to contact presence
        if (action === 'subscribe' || action === 'sub') {
            const target = args[1] ? args[1].replace(/[^0-9]/g, '') : '';
            if (!target) {
                await sock.sendMessage(chatId, {
                    text: '❌ *Usage:* `.presence subscribe 254712345678`',
                    ...channelInfo
                }, { quoted: message });
                return;
            }
            const targetJid = target + '@s.whatsapp.net';
            try {
                await sock.presenceSubscribe(targetJid);
                global.presenceSubscriptions.set(targetJid, {
                    subscribedAt: Date.now(),
                    subscriberChatId: chatId
                });

                await sock.sendMessage(chatId, {
                    text: `📡 *Subscribed to live presence for:* +${target}\n_You will receive notifications when this contact comes online or types._`,
                    ...channelInfo
                }, { quoted: message });
            } catch (e) {
                await sock.sendMessage(chatId, {
                    text: `❌ *Failed to subscribe:* ${e.message}`,
                    ...channelInfo
                }, { quoted: message });
            }
            return;
        }

        // 8. Check contact presence
        if (action === 'check') {
            const target = args[1] ? args[1].replace(/[^0-9]/g, '') : '';
            if (!target) {
                await sock.sendMessage(chatId, {
                    text: '❌ *Usage:* `.presence check 254712345678`',
                    ...channelInfo
                }, { quoted: message });
                return;
            }
            const targetJid = target + '@s.whatsapp.net';
            try {
                await sock.presenceSubscribe(targetJid);
                const sub = global.presenceSubscriptions.get(targetJid);
                const lastSeen = sub?.lastSeen ? new Date(sub.lastSeen).toLocaleTimeString() : 'Privacy-gated or unknown';
                const status = sub?.lastKnownPresence || 'Unavailable / Offline';

                await sock.sendMessage(chatId, {
                    text: `🔍 *Presence Info for +${target}*\n\n` +
                        `🔹 *Status:* \`${status}\`\n` +
                        `🔹 *Last Seen:* \`${lastSeen}\`\n\n` +
                        `_Note: Contact presence depends on their WhatsApp privacy settings._`,
                    ...channelInfo
                }, { quoted: message });
            } catch (e) {
                await sock.sendMessage(chatId, {
                    text: `❌ *Error querying presence:* ${e.message}`,
                    ...channelInfo
                }, { quoted: message });
            }
            return;
        }

        await sock.sendMessage(chatId, {
            text: '❌ *Invalid presence action!*\nUse `.presence` to view available options.',
            ...channelInfo
        }, { quoted: message });
    },

    getPresenceConfig,
    savePresenceConfig,
    sendPresence
};
