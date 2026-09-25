'use strict';

/**
 * Custom Baileys Socket Enhancements & Monkey-Patch Layer
 * 
 * Features:
 * 1. Status Reaction Shield: Guarantees statusJidList: [participant, botJid] and blocks DM leak (kills "Waiting for this message").
 * 2. Native Interactive & Button Messages: Native flow buttons, list templates, and markdown tables.
 * 3. Complete Newsletter Engine: create, metadata, follow, unfollow, mute, unmute, subscribers, react.
 * 4. Resilient Presence & Keepalive: Prevents WebSocket congestion during alwaysOnline.
 * 5. Multi-Device JID/LID Resolution: Standardized participant identification.
 */

const {
    proto,
    generateWAMessageFromContent,
    generateMessageID,
    jidDecode,
    jidNormalizedUser,
    delay
} = require('@whiskeysockets/baileys');

// Official WhatsApp GraphQL Query IDs for w:mex queries (Newsletters)
const NEWSLETTER_QUERY_IDS = {
    CREATE: '6330026447039299',
    UPDATE_METADATA: '7150902998257522',
    SUBSCRIBERS: '6300870199982737',
    METADATA: '6620195908089573',
    FOLLOW: '7871414976211147',
    UNFOLLOW: '7238632346214362',
    MUTE: '251512824694272',
    UNMUTE: '7386057344737856',
    DELETE: '8316537688363079',
    ADMIN_COUNT: '7130823597031706',
    CHANGE_OWNER: '7341777602580933',
    DEMOTE: '6551828931592901'
};

/**
 * Execute a W:MEX GraphQL query over WhatsApp WebSocket IQ
 */
async function executeWMexQuery(sock, variables, queryId) {
    if (!sock || typeof sock.query !== 'function') {
        throw new Error('Socket does not support query method');
    }
    const messageTag = typeof sock.generateMessageTag === 'function'
        ? sock.generateMessageTag()
        : generateMessageID();

    const res = await sock.query({
        tag: 'iq',
        attrs: {
            id: messageTag,
            type: 'get',
            to: 's.whatsapp.net',
            xmlns: 'w:mex'
        },
        content: [
            {
                tag: 'query',
                attrs: { query_id: queryId },
                content: Buffer.from(JSON.stringify({ variables }), 'utf-8')
            }
        ]
    });

    if (res && res.content && Array.isArray(res.content)) {
        const resultChild = res.content.find(c => c && c.tag === 'result');
        if (resultChild && resultChild.content) {
            try {
                const parsed = JSON.parse(resultChild.content.toString());
                if (parsed.errors && parsed.errors.length > 0) {
                    throw new Error(parsed.errors.map(e => e.message || 'Unknown GraphQL error').join(', '));
                }
                return parsed.data || parsed;
            } catch (err) {
                if (err.message.includes('GraphQL') || err.message.includes('error')) {
                    throw err;
                }
                return resultChild.content;
            }
        }
    }
    return res;
}

/**
 * Build Native Flow Interactive Message Payload
 */
function buildNativeFlowMessage({ text = '', footer = '', title = '', buttons = [], contextInfo = {} }) {
    const formattedButtons = (buttons || []).map((btn, index) => {
        if (btn.name && btn.buttonParamsJson) {
            return btn;
        }
        if (btn.type === 'url' || btn.url) {
            return {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: btn.text || btn.display_text || 'Open Link',
                    url: btn.url,
                    merchant_url: btn.url
                })
            };
        }
        if (btn.type === 'copy' || btn.copy_code || btn.code) {
            return {
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({
                    display_text: btn.text || btn.display_text || 'Copy Code',
                    copy_code: btn.copy_code || btn.code
                })
            };
        }
        if (btn.type === 'call' || btn.phone_number) {
            return {
                name: 'cta_call',
                buttonParamsJson: JSON.stringify({
                    display_text: btn.text || btn.display_text || 'Call',
                    phone_number: btn.phone_number
                })
            };
        }
        // Default quick reply button
        return {
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
                display_text: btn.text || btn.display_text || `Option ${index + 1}`,
                id: btn.id || btn.command || `${index + 1}`
            })
        };
    });

    const interactiveMessage = {
        body: { text: text || '' },
        footer: footer ? { text: footer } : undefined,
        header: title ? { title: title, hasMediaAttachment: false } : undefined,
        nativeFlowMessage: {
            buttons: formattedButtons,
            messageVersion: 1
        },
        contextInfo: contextInfo || {}
    };

    return {
        viewOnceMessage: {
            message: {
                messageContextInfo: {
                    deviceListMetadata: {},
                    deviceListMetadataVersion: 2
                },
                interactiveMessage
            }
        }
    };
}

/**
 * Patches a Baileys WASocket instance with custom capabilities and safety guards.
 * @param {import('@whiskeysockets/baileys').WASocket} sock 
 * @param {object} options 
 */
function patchBaileysSocket(sock, options = {}) {
    if (!sock) return sock;
    if (sock._isCustomPatched) return sock;
    sock._isCustomPatched = true;

    const store = options.store;

    // 1. Standardized decodeJid method
    const originalDecodeJid = sock.decodeJid;
    sock.decodeJid = (jid) => {
        if (!jid) return jid;
        if (jid === 'status@broadcast') return jid;
        if (jid.endsWith('@newsletter')) return jid;
        if (/:\d+@/gi.test(jid)) {
            const decode = jidDecode(jid) || {};
            return (decode.user && decode.server) ? `${decode.user}@${decode.server}` : jid;
        }
        if (typeof originalDecodeJid === 'function') {
            return originalDecodeJid(jid);
        }
        return jid;
    };

    // 2. Intercept sendMessage
    const originalSendMessage = sock.sendMessage;
    sock.sendMessage = async function(jid, content, sendOptions = {}) {
        // --- A. Status Reaction & DM Spillover Guard ---
        if (content && content.react) {
            const reactKey = content.react.key;
            if (reactKey && reactKey.remoteJid === 'status@broadcast') {
                // A status reaction MUST NEVER be sent to a user's private DM
                // Force recipient to status@broadcast
                jid = 'status@broadcast';

                const targetSet = new Set();
                const participant = reactKey.participant || reactKey.participantPn;
                if (participant && participant !== 'status@broadcast') {
                    targetSet.add(sock.decodeJid(participant));
                }
                if (sock.user?.id) {
                    targetSet.add(sock.decodeJid(sock.user.id));
                }
                if (Array.isArray(sendOptions.statusJidList)) {
                    sendOptions.statusJidList.forEach(item => {
                        if (item && item !== 'status@broadcast') {
                            targetSet.add(sock.decodeJid(item));
                        }
                    });
                }

                sendOptions.statusJidList = Array.from(targetSet).filter(Boolean);
            }
        }

        // --- B. Button / Native Flow Messages Shorthand ---
        if (content && (content.buttons || content.nativeFlowButtons)) {
            const buttons = content.buttons || content.nativeFlowButtons;
            const buttonPayload = buildNativeFlowMessage({
                text: content.text || content.caption || '',
                footer: content.footer || '',
                title: content.title || '',
                buttons,
                contextInfo: content.contextInfo || {}
            });
            const msgId = typeof this.generateMessageTag === 'function' ? this.generateMessageTag() : generateMessageID();
            return await this.relayMessage(jid, buttonPayload, {
                messageId: msgId,
                quoted: sendOptions.quoted
            });
        }

        return await originalSendMessage.call(this, jid, content, sendOptions);
    };

    // 3. Intercept relayMessage
    const originalRelayMessage = sock.relayMessage;
    sock.relayMessage = async function(jid, message, relayOptions = {}) {
        // Safeguard reaction messages referencing status@broadcast
        if (message?.reactionMessage?.key?.remoteJid === 'status@broadcast') {
            jid = 'status@broadcast';
            const targetSet = new Set();
            const participant = message.reactionMessage.key.participant || message.reactionMessage.key.participantPn;
            if (participant && participant !== 'status@broadcast') {
                targetSet.add(sock.decodeJid(participant));
            }
            if (sock.user?.id) {
                targetSet.add(sock.decodeJid(sock.user.id));
            }
            if (Array.isArray(relayOptions.statusJidList)) {
                relayOptions.statusJidList.forEach(item => {
                    if (item && item !== 'status@broadcast') {
                        targetSet.add(sock.decodeJid(item));
                    }
                });
            }
            relayOptions.statusJidList = Array.from(targetSet).filter(Boolean);
        }

        return await originalRelayMessage.call(this, jid, message, relayOptions);
    };

    // 4. Native Helpers for Buttons & Tables
    sock.sendButtons = async function(jid, { text, footer, title, buttons, contextInfo }, quoted) {
        const payload = buildNativeFlowMessage({ text, footer, title, buttons, contextInfo });
        const msgId = typeof this.generateMessageTag === 'function' ? this.generateMessageTag() : generateMessageID();
        return await this.relayMessage(jid, payload, { messageId: msgId, quoted });
    };

    sock.sendTable = async function(jid, { title, headers = [], rows = [] }, quoted) {
        let output = '';
        if (title) output += `*${title}*\n\n`;
        if (headers && headers.length > 0) {
            output += `| ${headers.join(' | ')} |\n`;
            output += `| ${headers.map(() => '---').join(' | ')} |\n`;
        }
        for (const row of rows) {
            if (Array.isArray(row)) {
                output += `| ${row.join(' | ')} |\n`;
            } else {
                output += `| ${row} |\n`;
            }
        }
        return await this.sendMessage(jid, { text: output.trim() }, { quoted });
    };

    // 5. Complete Newsletter Engine
    sock.newsletterCreate = async function(name, description = '') {
        return await executeWMexQuery(this, {
            input: { name, description: description || null }
        }, NEWSLETTER_QUERY_IDS.CREATE);
    };

    sock.newsletterMetadata = async function(type = 'JID', key) {
        return await executeWMexQuery(this, {
            fetch_creation_time: true,
            fetch_full_image: true,
            fetch_viewer_metadata: true,
            input: { key, type: String(type).toUpperCase() }
        }, NEWSLETTER_QUERY_IDS.METADATA);
    };

    sock.newsletterFollow = async function(jid) {
        const messageTag = typeof this.generateMessageTag === 'function'
            ? this.generateMessageTag()
            : generateMessageID();
        return await this.query({
            tag: 'iq',
            attrs: {
                id: messageTag,
                type: 'get',
                xmlns: 'w:mex',
                to: 's.whatsapp.net',
            },
            content: [
                {
                    tag: 'query',
                    attrs: { query_id: NEWSLETTER_QUERY_IDS.FOLLOW },
                    content: Buffer.from(JSON.stringify({ variables: { newsletter_id: jid } }))
                }
            ]
        });
    };

    sock.newsletterUnfollow = async function(jid) {
        return await executeWMexQuery(this, { newsletter_id: jid }, NEWSLETTER_QUERY_IDS.UNFOLLOW);
    };

    sock.newsletterMute = async function(jid) {
        return await executeWMexQuery(this, { newsletter_id: jid }, NEWSLETTER_QUERY_IDS.MUTE);
    };

    sock.newsletterUnmute = async function(jid) {
        return await executeWMexQuery(this, { newsletter_id: jid }, NEWSLETTER_QUERY_IDS.UNMUTE);
    };

    sock.newsletterSubscribers = async function(jid) {
        return await executeWMexQuery(this, { newsletter_id: jid }, NEWSLETTER_QUERY_IDS.SUBSCRIBERS);
    };

    sock.newsletterReactMessage = async function(jid, serverId, reaction) {
        const messageTag = typeof this.generateMessageTag === 'function'
            ? this.generateMessageTag()
            : generateMessageID();
        return await this.query({
            tag: 'message',
            attrs: {
                to: jid,
                ...(reaction ? {} : { edit: '7' }),
                type: 'reaction',
                server_id: String(serverId),
                id: messageTag
            },
            content: [
                {
                    tag: 'reaction',
                    attrs: reaction ? { code: reaction } : {}
                }
            ]
        });
    };

    // 6. Safe Presence Handling
    const originalSendPresenceUpdate = sock.sendPresenceUpdate;
    sock.sendPresenceUpdate = async function(...args) {
        if (!this.ws || this.ws.readyState !== 1) return;
        try {
            const ghostMode = store ? await store.getSetting('global', 'stealthMode') : null;
            if (ghostMode && ghostMode.enabled) return;

            return await originalSendPresenceUpdate.apply(this, args);
        } catch {}
    };

    return sock;
}

module.exports = {
    patchBaileysSocket,
    buildNativeFlowMessage,
    executeWMexQuery,
    NEWSLETTER_QUERY_IDS
};
