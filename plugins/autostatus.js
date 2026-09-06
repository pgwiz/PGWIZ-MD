const fs = require('fs');
const path = require('path');
const store = require('../lib/lightweight_store');
const settings = require('../settings');

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
const POSTGRES_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const MYSQL_URL = process.env.MYSQL_URL;
const SQLITE_URL = process.env.DB_URL;
const HAS_DB = !!(MONGO_URL || POSTGRES_URL || MYSQL_URL || SQLITE_URL);

const configPath = path.join(__dirname, '../data/autoStatus.json');

const STRATEGY_DESCRIPTIONS = {
    1: 'Classic Relay to Broadcast (with status messageId)',
    2: 'Fresh Message ID Relay to Broadcast (multi-device JID list)',
    3: 'Direct Author 1:1 Relay (relayMessage to participant directly)',
    4: 'Direct Author Native React (sendMessage to participant directly)',
    5: 'Normalized Phone Broadcast (relayMessage with clean @s.whatsapp.net)',
    6: 'Native Broadcast React (sendMessage to status@broadcast with statusJidList)'
};

const STRATEGY_DEFAULT_EMOJIS = {
    1: '❤️',
    2: '🔥',
    3: '🌟',
    4: '👏',
    5: '💚',
    6: '⚡'
};

const DEFAULTS = {
    view: true,
    react: true,
    reaction: '💚',
    strategy: 1,
    emojis: ['❤️', '🔥', '✨', '💯', '🌟', '⚡', '😍', '👏', '💖', '🥰', '👍', '🎉']
};

if (!HAS_DB && !fs.existsSync(configPath)) {
    try {
        if (!fs.existsSync(path.dirname(configPath))) {
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
        }
        fs.writeFileSync(configPath, JSON.stringify(DEFAULTS, null, 2));
    } catch {}
}

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

function parseEnvBool(val, fallback = true) {
    if (val === undefined || val === null || String(val).trim() === '') return fallback;
    const s = String(val).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'enabled') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === 'disabled') return false;
    return fallback;
}

async function readConfig() {
    try {
        const envViewRaw = process.env.AUTO_STATUS_VIEW ?? process.env.AUTO_STATUS_READ ?? process.env.AUTO_READ_STATUS;
        const envReactRaw = process.env.AUTO_STATUS_REACT ?? process.env.AUTO_REACT_STATUS;
        const envStrategyRaw = process.env.AUTO_STATUS_STRATEGY;

        const hasEnvView = envViewRaw !== undefined && String(envViewRaw).trim() !== '';
        const hasEnvReact = envReactRaw !== undefined && String(envReactRaw).trim() !== '';
        const hasEnvStrategy = envStrategyRaw !== undefined && !isNaN(parseInt(envStrategyRaw, 10));

        if (HAS_DB) {
            const config = await store.getSetting('global', 'autoStatus');
            const data = config || DEFAULTS;
            return {
                view: hasEnvView ? parseEnvBool(envViewRaw, true) : (data.view !== undefined ? parseEnvBool(data.view, true) : (data.enabled !== undefined ? parseEnvBool(data.enabled, true) : true)),
                react: hasEnvReact ? parseEnvBool(envReactRaw, true) : (data.react !== undefined ? parseEnvBool(data.react, true) : (data.reactOn !== undefined ? parseEnvBool(data.reactOn, true) : true)),
                reaction: data.reaction || '💚',
                strategy: hasEnvStrategy ? parseInt(envStrategyRaw, 10) : (Number(data.strategy) || 1),
                emojis: data.emojis || DEFAULTS.emojis
            };
        } else {
            if (!fs.existsSync(configPath)) return { ...DEFAULTS };
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return {
                view: hasEnvView ? parseEnvBool(envViewRaw, true) : (data.view !== undefined ? parseEnvBool(data.view, true) : (data.enabled !== undefined ? parseEnvBool(data.enabled, true) : true)),
                react: hasEnvReact ? parseEnvBool(envReactRaw, true) : (data.react !== undefined ? parseEnvBool(data.react, true) : (data.reactOn !== undefined ? parseEnvBool(data.reactOn, true) : true)),
                reaction: data.reaction || '💚',
                strategy: hasEnvStrategy ? parseInt(envStrategyRaw, 10) : (Number(data.strategy) || 1),
                emojis: data.emojis || DEFAULTS.emojis
            };
        }
    } catch (e) {
        return { ...DEFAULTS };
    }
}

async function writeConfig(config) {
    try {
        if (config.view !== undefined) process.env.AUTO_STATUS_VIEW = String(config.view);
        if (config.react !== undefined) process.env.AUTO_STATUS_REACT = String(config.react);
        if (config.strategy !== undefined) process.env.AUTO_STATUS_STRATEGY = String(config.strategy);

        if (HAS_DB) {
            await store.saveSetting('global', 'autoStatus', config);
        } else {
            if (!fs.existsSync(path.dirname(configPath))) {
                fs.mkdirSync(path.dirname(configPath), { recursive: true });
            }
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        }
        return true;
    } catch (e) {
        console.error('[autostatus] Error writing config:', e.message);
        return false;
    }
}

async function isAutoStatusEnabled() {
    const cfg = await readConfig();
    return cfg.view !== false;
}

async function isStatusReactionEnabled() {
    const cfg = await readConfig();
    return cfg.react !== false;
}

function getStatusEmoji(cfg) {
    const envEmoji = process.env.STATUS_REACTION || process.env.STATUS_EMOJI;
    if (envEmoji && envEmoji.trim() !== '') return envEmoji.trim();
    return cfg.reaction || '💚';
}

// Track reacted statuses to prevent duplicate reaction stanzas
const reactedStatusKeys = new Set();
setInterval(() => {
    if (reactedStatusKeys.size > 2000) reactedStatusKeys.clear();
}, 60000);

// In-memory cache of recent status messages per participant/number
const recentStatusCache = new Map();
function cacheRecentStatus(key) {
    if (!key || !key.id) return;
    const participant = key.participant || key.remoteJid;
    if (participant && participant !== 'status@broadcast') {
        recentStatusCache.set(participant, key);
        const num = participant.split('@')[0];
        if (num) recentStatusCache.set(num, key);
    }
    // Limit cache size to 500 entries
    if (recentStatusCache.size > 500) {
        const firstKey = recentStatusCache.keys().next().value;
        recentStatusCache.delete(firstKey);
    }
}

/**
 * Execute a specific Baileys status reaction strategy
 */
async function executeReactionStrategy(sock, strategyNum, statusKey, emoji) {
    const rawParticipant = statusKey.participant || statusKey.remoteJid;
    if (!rawParticipant || rawParticipant === 'status@broadcast') {
        throw new Error('Invalid status participant');
    }

    const cleanNum = rawParticipant.replace(/[^0-9]/g, '');
    const phoneJid = cleanNum ? (cleanNum + '@s.whatsapp.net') : rawParticipant;
    const normParticipant = rawParticipant.includes('@')
        ? (rawParticipant.split(':')[0] + (rawParticipant.includes('@lid') ? '@lid' : '@s.whatsapp.net'))
        : rawParticipant;

    const reactionKey = {
        remoteJid: 'status@broadcast',
        id: statusKey.id,
        participant: rawParticipant,
        fromMe: false
    };

    switch (Number(strategyNum)) {
        case 1: {
            // Strategy 1: Classic Upstream Relay to status@broadcast
            const statusJidList = [rawParticipant].filter(j => j && j !== 'status@broadcast');
            return await sock.relayMessage('status@broadcast', {
                reactionMessage: {
                    key: reactionKey,
                    text: emoji
                }
            }, {
                messageId: statusKey.id,
                statusJidList: statusJidList.length > 0 ? statusJidList : [rawParticipant]
            });
        }
        case 2: {
            // Strategy 2: Fresh generated Message ID Relay to status@broadcast with multi-device list
            const statusJidList = Array.from(new Set([rawParticipant, phoneJid, normParticipant])).filter(j => j && j !== 'status@broadcast');
            return await sock.relayMessage('status@broadcast', {
                reactionMessage: {
                    key: reactionKey,
                    text: emoji
                }
            }, {
                statusJidList
            });
        }
        case 3: {
            // Strategy 3: Direct Author 1:1 Relay (send reactionMessage stanza directly to the user's DM session)
            return await sock.relayMessage(rawParticipant, {
                reactionMessage: {
                    key: reactionKey,
                    text: emoji
                }
            }, {});
        }
        case 4: {
            // Strategy 4: Direct Author Native React (sock.sendMessage to author with status key)
            return await sock.sendMessage(rawParticipant, {
                react: {
                    text: emoji,
                    key: reactionKey
                }
            });
        }
        case 5: {
            // Strategy 5: Normalized Phone Broadcast (relayMessage with phone @s.whatsapp.net only)
            const statusJidList = [phoneJid].filter(j => j && j !== 'status@broadcast');
            return await sock.relayMessage('status@broadcast', {
                reactionMessage: {
                    key: {
                        remoteJid: 'status@broadcast',
                        id: statusKey.id,
                        participant: phoneJid,
                        fromMe: false
                    },
                    text: emoji
                }
            }, {
                messageId: statusKey.id,
                statusJidList
            });
        }
        case 6: {
            // Strategy 6: Native Broadcast React (sock.sendMessage to status@broadcast with statusJidList)
            const statusJidList = Array.from(new Set([rawParticipant, phoneJid])).filter(j => j && j !== 'status@broadcast');
            return await sock.sendMessage('status@broadcast', {
                react: {
                    text: emoji,
                    key: reactionKey
                }
            }, {
                statusJidList
            });
        }
        default:
            throw new Error(`Unknown strategy: ${strategyNum}`);
    }
}

async function reactToStatus(sock, statusKey, customEmoji = null, customStrategy = null) {
    try {
        if (!sock || !statusKey?.id) return false;
        const enabled = customEmoji ? true : await isStatusReactionEnabled();
        if (!enabled) return false;

        const cfg = await readConfig();
        const emoji = customEmoji || getStatusEmoji(cfg);
        const strat = Number(customStrategy) || Number(cfg.strategy) || 1;

        await executeReactionStrategy(sock, strat, statusKey, emoji);
        console.log(`[AUTOSTATUS] ✅ Reacted to status ${statusKey.id} from ${statusKey.participant || 'contact'} with ${emoji} (Strategy ${strat})`);
        return true;
    } catch (error) {
        console.error(`[AUTOSTATUS] ❌ Error reacting to status (Strategy ${customStrategy || 'default'}):`, error.message);
        return false;
    }
}

async function handleStatusUpdate(sock, status) {
    try {
        if (!sock) return;
        const config = await readConfig();
        if (!config.view && !config.react) return;

        await new Promise(resolve => setTimeout(resolve, 800));

        const msgs = status.messages || (status.key ? [status] : (status.reaction?.key ? [status.reaction] : []));
        for (const msg of msgs) {
            const key = msg.key || msg;
            if (!key || key.remoteJid !== 'status@broadcast') continue;
            if (key.fromMe || msg.fromMe) continue;
            if (msg.message?.reactionMessage) continue;

            const msgId = key.id;
            if (reactedStatusKeys.has(msgId)) continue;
            reactedStatusKeys.add(msgId);

            // Cache for dev/debug lookup
            cacheRecentStatus(key);

            // Check ignore list
            const senderNum = (key.participant || '').split('@')[0];
            if (senderNum && HAS_DB) {
                const ignoreList = (await store.getSetting('global', 'autoStatusIgnoreList').catch(() => [])) || [];
                if (ignoreList.includes(senderNum)) {
                    continue;
                }
            }

            // 1. View status (use only standard Baileys readMessages)
            if (config.view) {
                try {
                    await sock.readMessages([key]);
                    console.log(`[AUTOSTATUS] 👀 Viewed status ${key.id} from ${key.participant || 'contact'}`);
                } catch (err) {
                    if (err.message?.includes('rate-overlimit')) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await sock.readMessages([key]).catch(() => {});
                    }
                }
            }

            // 2. React to status using configured strategy
            if (config.react) {
                await reactToStatus(sock, key);
            }
        }
    } catch (error) {
        console.error('[AUTOSTATUS] ❌ Error in handleStatusUpdate:', error.message);
    }
}

module.exports = {
    command: 'autostatus',
    aliases: ['astatus', 'asv', 'autoview', 'statusview'],
    category: 'owner',
    description: 'Auto view and react to status updates (owner only)',
    usage: '.autostatus [view on/off] [react on/off] [strategy <1-6>] [reaction <emoji>] [readreceipts on/off]',
    ownerOnly: true,

    async handler(sock, message, args, context = {}) {
        const chatId = context.chatId || message.key.remoteJid;
        try {
            const cfg = await readConfig();
            const ignoreList = (HAS_DB ? await store.getSetting('global', 'autoStatusIgnoreList') : []) || [];
            const activeStrategyName = STRATEGY_DESCRIPTIONS[cfg.strategy] || STRATEGY_DESCRIPTIONS[1];

            if (!args || args.length === 0) {
                let privacyNote = '';
                try {
                    const privacy = await sock.fetchPrivacySettings?.();
                    const rr = privacy?.readreceipts || 'unknown';
                    privacyNote = rr !== 'all'
                        ? `\n⚠️ *Bot Read Receipts:* *${rr}* (Status posters may NOT see views. Type \`.autostatus readreceipts on\` to fix)`
                        : `\n✅ *Bot Read Receipts:* *${rr}* (Views visible to status posters)`;
                } catch (_) {}

                return await sock.sendMessage(chatId, {
                    text: `📱 *AutoStatus Settings*\n\n` +
                        `👁️ *Auto View:* *${cfg.view ? 'ON' : 'OFF'}* (Views status updates immediately)\n` +
                        `💫 *Auto React:* *${cfg.react ? 'ON' : 'OFF'}* (Reacts to status updates)\n` +
                        `✨ *Reaction Emoji:* ${cfg.reaction}\n` +
                        `⚙️ *Reaction Strategy:* *Strategy ${cfg.strategy}* (${activeStrategyName})\n` +
                        `🗄️ *Storage:* ${HAS_DB ? 'Database' : 'File System'}\n` +
                        `🚫 *Ignored Contacts:* ${ignoreList.length}` +
                        privacyNote + `\n\n` +
                        `*Commands:*\n` +
                        `• \`.autostatus view on/off\` - Toggle status viewing\n` +
                        `• \`.autostatus react on/off\` - Toggle status reaction\n` +
                        `• \`.autostatus strategy <1-6>\` - Set reaction strategy (1 to 6)\n` +
                        `• \`.autostatus reaction <emoji>\` - Set status reaction emoji\n` +
                        `• \`.autostatus readreceipts on/off\` - Toggle WhatsApp read receipts privacy\n` +
                        `• \`.autostatus on/off\` - Global toggle\n` +
                        `• \`.autostatus ignore <number>\` - Exclude contact\n` +
                        `• \`.autostatus unignore <number>\` - Remove contact\n` +
                        `• \`.autostatus ignored\` - List excluded contacts\n\n` +
                        `*🧪 Diagnostic Probes (Hidden Dev Tools):*\n` +
                        `• \`.autostatus dev <1-6> [emoji]\` - Test specific reaction strategy on status\n` +
                        `• \`.autostatus dev all [emoji]\` - Test ALL 6 strategies sequentially\n` +
                        `• Reply/quote a status with \`.autostatus dev <1-6|all>\``,
                    ...channelInfo
                }, { quoted: message });
            }

            const sub = args[0].toLowerCase();
            const val = args[1]?.toLowerCase();

            // === Hidden Dev Diagnostic Multi-Strategy Probe Command ===
            if (sub === 'dev' || sub === 'test' || sub === 'debug') {
                let targetKey = null;
                let requestedStrategy = null;
                let requestedEmoji = null;

                // 1. Check if user quoted a status message
                let innerMsg = message.message;
                if (innerMsg?.ephemeralMessage?.message) innerMsg = innerMsg.ephemeralMessage.message;
                if (innerMsg?.viewOnceMessage?.message) innerMsg = innerMsg.viewOnceMessage.message;
                const mType = innerMsg ? Object.keys(innerMsg)[0] : '';
                const ctx = innerMsg?.[mType]?.contextInfo || innerMsg?.extendedTextMessage?.contextInfo || message.message?.extendedTextMessage?.contextInfo;

                if (ctx && ctx.remoteJid === 'status@broadcast' && ctx.stanzaId) {
                    targetKey = {
                        remoteJid: 'status@broadcast',
                        id: ctx.stanzaId,
                        participant: ctx.participant || '',
                        fromMe: false
                    };
                }

                // Parse remaining args for strategy, phone/JID, and emoji
                const devArgs = args.slice(1);
                for (const arg of devArgs) {
                    const cleanArg = arg.trim();
                    if (!cleanArg) continue;

                    if (cleanArg.toLowerCase() === 'all') {
                        requestedStrategy = 'all';
                    } else if (/^[1-6]$/.test(cleanArg)) {
                        requestedStrategy = parseInt(cleanArg, 10);
                    } else if (cleanArg.match(/^[0-9+@]/) && cleanArg.length >= 8) {
                        // Phone number or JID
                        if (!targetKey) {
                            const cleanNum = cleanArg.replace(/[^0-9]/g, '');
                            const cached = recentStatusCache.get(cleanNum) || recentStatusCache.get(cleanArg);
                            if (cached) {
                                targetKey = cached;
                            }
                        }
                    } else {
                        // Emoji or custom text
                        requestedEmoji = cleanArg;
                    }
                }

                if (!targetKey) {
                    const cachedCount = recentStatusCache.size;
                    return await sock.sendMessage(chatId, {
                        text: `🛠️ *AutoStatus Dev Diagnostic Suite*\n\n` +
                            `*How to use:*\n` +
                            `Reply to any status message with:\n` +
                            `• \`.autostatus dev 1 [emoji]\` - Test Strategy 1 (${STRATEGY_DESCRIPTIONS[1]})\n` +
                            `• \`.autostatus dev 2 [emoji]\` - Test Strategy 2 (${STRATEGY_DESCRIPTIONS[2]})\n` +
                            `• \`.autostatus dev 3 [emoji]\` - Test Strategy 3 (${STRATEGY_DESCRIPTIONS[3]})\n` +
                            `• \`.autostatus dev 4 [emoji]\` - Test Strategy 4 (${STRATEGY_DESCRIPTIONS[4]})\n` +
                            `• \`.autostatus dev 5 [emoji]\` - Test Strategy 5 (${STRATEGY_DESCRIPTIONS[5]})\n` +
                            `• \`.autostatus dev 6 [emoji]\` - Test Strategy 6 (${STRATEGY_DESCRIPTIONS[6]})\n` +
                            `• \`.autostatus dev all [emoji]\` - Test ALL 6 strategies sequentially\n\n` +
                            `_Current status memory cache:_ ${cachedCount} active statuses. Please reply/quote a status directly to probe.`,
                        ...channelInfo
                    }, { quoted: message });
                }

                const targetParticipant = targetKey.participant || targetKey.remoteJid;
                const targetId = targetKey.id;

                const startTime = Date.now();
                const logs = [];
                const log = (text) => {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
                    logs.push(`[+${elapsed}s] ${text}`);
                };

                const isAll = requestedStrategy === 'all';
                const strategyToRun = isAll ? 'ALL (1 to 6)' : (requestedStrategy || cfg.strategy || 1);
                const emojiToUse = requestedEmoji || cfg.reaction || '💚';

                log(`Diagnostic probe started for: ${targetParticipant}`);
                log(`Target Stanza ID: ${targetId}`);
                log(`Strategy: ${strategyToRun}`);

                // Send instant ACK in current chat
                await sock.sendMessage(chatId, {
                    text: `🛠️ *AutoStatus Dev Probe Started*\n\n` +
                        `🎯 *Target:* \`${targetParticipant}\`\n` +
                        `🆔 *Stanza ID:* \`${targetId}\`\n` +
                        `⚙️ *Strategy:* ${strategyToRun}\n` +
                        `✨ *Emoji:* ${emojiToUse}\n` +
                        `⏳ *Window:* 30s observation...\n\n` +
                        `_Testing reaction stanzas and monitoring live socket events. Report will be delivered to Owner DM._`,
                    ...channelInfo
                }, { quoted: message });

                // Step 1: Privacy check
                let privacyState = 'unknown';
                try {
                    const privacy = await sock.fetchPrivacySettings?.();
                    privacyState = privacy?.readreceipts || 'unknown';
                    log(`WhatsApp Read Receipts Privacy: ${privacyState}`);
                } catch (pe) {
                    log(`Privacy check error: ${pe.message}`);
                }

                // Step 2: Mark Viewed
                try {
                    await sock.readMessages([targetKey]);
                    log(`readMessages dispatched for status ${targetId}`);
                } catch (ve) {
                    log(`readMessages error: ${ve.message}`);
                }

                // Step 3: Dispatch Strategies
                const strategiesToTest = isAll ? [1, 2, 3, 4, 5, 6] : [Number(strategyToRun)];

                (async () => {
                    for (let i = 0; i < strategiesToTest.length; i++) {
                        const sNum = strategiesToTest[i];
                        const sEmoji = requestedEmoji || STRATEGY_DEFAULT_EMOJIS[sNum] || emojiToUse;
                        try {
                            log(`[STRATEGY ${sNum}] Dispatching "${STRATEGY_DESCRIPTIONS[sNum]}" with emoji ${sEmoji}...`);
                            await executeReactionStrategy(sock, sNum, targetKey, sEmoji);
                            log(`[STRATEGY ${sNum}] ✅ Dispatched successfully! (Emoji: ${sEmoji})`);
                        } catch (err) {
                            log(`[STRATEGY ${sNum}] ❌ Error: ${err.message}`);
                        }
                        if (isAll && i < strategiesToTest.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 2500));
                        }
                    }
                })().catch(e => log(`Strategy execution loop error: ${e.message}`));

                // Step 4: Attach 30-Second Event Listener Collector
                const receiptEvents = [];
                const updateEvents = [];

                const onReceiptUpdate = (receipts) => {
                    for (const r of (Array.isArray(receipts) ? receipts : [receipts])) {
                        if (r?.key?.id === targetId || r?.key?.remoteJid === 'status@broadcast') {
                            receiptEvents.push(r);
                            log(`[EVENT] message-receipt.update -> id: ${r?.key?.id || 'broadcast'} type: ${r?.receipt?.type || 'ack'}`);
                        }
                    }
                };

                const onMessagesUpdate = (updates) => {
                    for (const u of (Array.isArray(updates) ? updates : [updates])) {
                        if (u?.key?.id === targetId || u?.key?.remoteJid === 'status@broadcast') {
                            updateEvents.push(u);
                            log(`[EVENT] messages.update -> id: ${u?.key?.id || 'broadcast'}`);
                        }
                    }
                };

                if (sock.ev) {
                    sock.ev.on('message-receipt.update', onReceiptUpdate);
                    sock.ev.on('messages.update', onMessagesUpdate);
                }

                // 30s Timer -> Deliver Report to Owner DM
                setTimeout(async () => {
                    try {
                        if (sock.ev) {
                            sock.ev.off('message-receipt.update', onReceiptUpdate);
                            sock.ev.off('messages.update', onMessagesUpdate);
                        }

                        log(`30-second observation window completed.`);
                        log(`Receipt Events Captured: ${receiptEvents.length}`);
                        log(`Update Events Captured: ${updateEvents.length}`);

                        const ownerNum = (Array.isArray(settings.ownerNumber) ? settings.ownerNumber[0] : settings.ownerNumber) || (sock.user?.id ? sock.user.id.split(':')[0] : '');
                        const ownerJid = ownerNum ? (ownerNum.replace(/[^0-9]/g, '') + '@s.whatsapp.net') : chatId;

                        const strategySummary = isAll
                            ? `ALL 6 Strategies Tested (Emojis: ${Object.values(STRATEGY_DEFAULT_EMOJIS).join(' ')})`
                            : `Strategy ${strategyToRun} (${STRATEGY_DESCRIPTIONS[strategyToRun]})`;

                        const report = `📊 *AutoStatus Dev Diagnostic Report (30s)*\n\n` +
                            `🎯 *Target:* \`${targetParticipant}\`\n` +
                            `🆔 *Stanza ID:* \`${targetId}\`\n` +
                            `⚙️ *Tested:* ${strategySummary}\n` +
                            `🔒 *Read Receipts Privacy:* \`${privacyState}\`\n` +
                            `📬 *Receipt Events:* ${receiptEvents.length}\n` +
                            `🔄 *Update Events:* ${updateEvents.length}\n\n` +
                            `📋 *Diagnostic Timeline:*\n\`\`\`\n` +
                            logs.join('\n') +
                            `\n\`\`\`\n\n` +
                            `💡 *Next Step:* Once you see which emoji appeared on your status, type \`.autostatus strategy <number>\` to lock it in for all automatic reactions!\n\n` +
                            `> _MEGA-MD Developer Diagnostics_`;

                        if (ownerJid && ownerJid !== '@s.whatsapp.net') {
                            await sock.sendMessage(ownerJid, { text: report }).catch(() => {});
                        }
                        if (chatId !== ownerJid) {
                            await sock.sendMessage(chatId, { text: `✅ *AutoStatus Dev Probe Finished.* Full diagnostic report sent to Owner DM.` }).catch(() => {});
                        }
                    } catch (e) {
                        console.error('[autostatus dev report error]:', e.message);
                    }
                }, 30000);

                return;
            }

            if (sub === 'strategy' || sub === 'strat') {
                const sNum = parseInt(val, 10);
                if (!sNum || isNaN(sNum) || sNum < 1 || sNum > 6) {
                    const list = Object.entries(STRATEGY_DESCRIPTIONS).map(([k, v]) => `• *Strategy ${k}:* ${v}`).join('\n');
                    return await sock.sendMessage(chatId, {
                        text: `⚙️ *Available AutoStatus Reaction Strategies:*\n\n${list}\n\n*Usage:* \`.autostatus strategy <1-6>\`\n*Current Strategy:* *Strategy ${cfg.strategy}*`,
                        ...channelInfo
                    }, { quoted: message });
                }

                cfg.strategy = sNum;
                await writeConfig(cfg);
                return await sock.sendMessage(chatId, {
                    text: `✅ *AutoStatus reaction strategy set to Strategy ${sNum}!* \n\n_${STRATEGY_DESCRIPTIONS[sNum]}_\n\nAll automated status reactions will now use this strategy.`,
                    ...channelInfo
                }, { quoted: message });
            }

            if (sub === 'view') {
                if (val === 'on' || val === 'true' || val === '1') {
                    cfg.view = true;
                    await writeConfig(cfg);
                    return await sock.sendMessage(chatId, { text: '✅ AutoStatus *view* is ON. Bot will view status updates immediately.', ...channelInfo }, { quoted: message });
                }
                if (val === 'off' || val === 'false' || val === '0') {
                    cfg.view = false;
                    await writeConfig(cfg);
                    return await sock.sendMessage(chatId, { text: '❌ AutoStatus *view* is OFF.', ...channelInfo }, { quoted: message });
                }
                return await sock.sendMessage(chatId, { text: 'Usage: `.autostatus view on/off`', ...channelInfo }, { quoted: message });
            }

            if (sub === 'react') {
                if (val === 'on' || val === 'true' || val === '1') {
                    cfg.react = true;
                    await writeConfig(cfg);
                    return await sock.sendMessage(chatId, { text: `💫 AutoStatus *react* is ON. Bot will react with ${cfg.reaction} using Strategy ${cfg.strategy}.`, ...channelInfo }, { quoted: message });
                }
                if (val === 'off' || val === 'false' || val === '0') {
                    cfg.react = false;
                    await writeConfig(cfg);
                    return await sock.sendMessage(chatId, { text: '❌ AutoStatus *react* is OFF.', ...channelInfo }, { quoted: message });
                }
                return await sock.sendMessage(chatId, { text: 'Usage: `.autostatus react on/off`', ...channelInfo }, { quoted: message });
            }

            if (sub === 'reaction' || sub === 'emoji') {
                const emoji = args.slice(1).join(' ').trim();
                if (!emoji) {
                    return await sock.sendMessage(chatId, { text: `Current reaction: ${cfg.reaction}\nUsage: \`.autostatus reaction <emoji>\``, ...channelInfo }, { quoted: message });
                }
                cfg.reaction = emoji;
                await writeConfig(cfg);
                return await sock.sendMessage(chatId, { text: `✅ AutoStatus reaction emoji set to ${emoji}`, ...channelInfo }, { quoted: message });
            }

            if (sub === 'readreceipts' || sub === 'readreceipt') {
                if (val === 'on' || val === 'all') {
                    try {
                        await sock.updateReadReceiptsPrivacy?.('all');
                        return await sock.sendMessage(chatId, { text: '✅ Bot read receipts enabled (`all`). Status posters will now see when the bot views their status.', ...channelInfo }, { quoted: message });
                    } catch (e) {
                        return await sock.sendMessage(chatId, { text: '❌ Failed to update read receipts: ' + (e?.message || e), ...channelInfo }, { quoted: message });
                    }
                }
                if (val === 'off' || val === 'none') {
                    try {
                        await sock.updateReadReceiptsPrivacy?.('none');
                        return await sock.sendMessage(chatId, { text: '❌ Bot read receipts disabled (`none`).', ...channelInfo }, { quoted: message });
                    } catch (e) {
                        return await sock.sendMessage(chatId, { text: '❌ Failed to update read receipts: ' + (e?.message || e), ...channelInfo }, { quoted: message });
                    }
                }
                return await sock.sendMessage(chatId, { text: 'Usage: `.autostatus readreceipts on/off`', ...channelInfo }, { quoted: message });
            }

            if (sub === 'on' || sub === 'enable') {
                cfg.view = true;
                cfg.react = true;
                await writeConfig(cfg);
                return await sock.sendMessage(chatId, { text: `✅ AutoStatus *view* and *react* enabled! (Strategy ${cfg.strategy})`, ...channelInfo }, { quoted: message });
            }

            if (sub === 'off' || sub === 'disable') {
                cfg.view = false;
                cfg.react = false;
                await writeConfig(cfg);
                return await sock.sendMessage(chatId, { text: '❌ AutoStatus *view* and *react* disabled.', ...channelInfo }, { quoted: message });
            }

            if (sub === 'ignore') {
                const num = args[1] ? args[1].replace(/[^0-9]/g, '') : '';
                if (!num) return await sock.sendMessage(chatId, { text: '❌ Provide a phone number.\nUsage: `.autostatus ignore 254712345678`', ...channelInfo }, { quoted: message });
                if (!ignoreList.includes(num)) ignoreList.push(num);
                if (HAS_DB) await store.saveSetting('global', 'autoStatusIgnoreList', ignoreList);
                return await sock.sendMessage(chatId, { text: `🚫 *+${num}* added to status ignore list.`, ...channelInfo }, { quoted: message });
            }

            if (sub === 'unignore') {
                const num = args[1] ? args[1].replace(/[^0-9]/g, '') : '';
                if (!num) return await sock.sendMessage(chatId, { text: '❌ Provide a phone number.\nUsage: `.autostatus unignore 254712345678`', ...channelInfo }, { quoted: message });
                const newList = ignoreList.filter(n => n !== num);
                if (HAS_DB) await store.saveSetting('global', 'autoStatusIgnoreList', newList);
                return await sock.sendMessage(chatId, { text: `✅ *+${num}* removed from status ignore list.`, ...channelInfo }, { quoted: message });
            }

            if (sub === 'ignored') {
                const text = ignoreList.length === 0
                    ? '📋 *No contacts are currently ignored.*'
                    : `📋 *Ignored Contacts (${ignoreList.length}):*\n\n` + ignoreList.map((n, i) => `${i + 1}. +${n}`).join('\n');
                return await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
            }

            return await sock.sendMessage(chatId, {
                text: '❌ Invalid option.\nUse: `.autostatus view on/off` | `.autostatus react on/off` | `.autostatus strategy <1-6>` | `.autostatus reaction <emoji>` | `.autostatus readreceipts on/off`',
                ...channelInfo
            }, { quoted: message });

        } catch (err) {
            console.error('[autostatus cmd] error:', err);
            await sock.sendMessage(chatId, { text: '❌ Error managing autostatus: ' + err.message, ...channelInfo }, { quoted: message });
        }
    },

    handleStatusUpdate,
    isAutoStatusEnabled,
    isStatusReactionEnabled,
    executeReactionStrategy,
    reactToStatus,
    readConfig,
    writeConfig,
    STRATEGY_DESCRIPTIONS
};
