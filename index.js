// Zero-dependency environment loader with safe dotenv fallback (compatible with all panels & environments)
(function loadEnvironment() {
    try {
        require('dotenv').config();
    } catch {
        // Safe fallback: parse .env using native fs without external dependencies
        try {
            const fs = require('fs');
            const path = require('path');
            const candidates = [
                path.join(__dirname, '.env'),
                path.join(process.cwd(), '.env'),
                path.join(__dirname, '..', '.env'),
                path.join(process.cwd(), '..', '.env'),
                path.join(process.cwd(), 'pgwiz-md-litrop', '.env'),
                path.join(process.cwd(), 'MEGA-MD', '.env')
            ];
            for (const envFile of candidates) {
                if (fs.existsSync(envFile)) {
                    const raw = fs.readFileSync(envFile, 'utf8');
                    for (let line of raw.split(/\r?\n/)) {
                        line = line.trim();
                        if (!line || line.startsWith('#')) continue;
                        const eq = line.indexOf('=');
                        if (eq > 0) {
                            const key = line.substring(0, eq).trim();
                            let val = line.substring(eq + 1).trim();
                            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                                val = val.slice(1, -1);
                            }
                            if (process.env[key] === undefined) {
                                process.env[key] = val;
                            }
                        }
                    }
                    break;
                }
            }
        } catch {}
    }
})();

// Immediate HTTP server binding for Heroku/Koyeb/Render port compliance
try {
    const { server, PORT } = require('./lib/server');
    if (server && !server.listening) {
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`[SERVER] ✅ HTTP healthcheck server active on 0.0.0.0:${PORT}`);
        });
    }
} catch (e) {
    console.error('[SERVER] Warning: Early server start skipped:', e.message);
}

global.alwaysOnlineState = undefined;
global.botLaunchTimestamp = Math.floor(Date.now() / 1000);
/* process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; */

// Auto self-healing dependency installer for panels (Wispbyte, Pterodactyl, Replit, Koyeb, etc.)
try {
    require.resolve('@hapi/boom');
} catch (e) {
    console.log('⚠️ Missing dependencies detected in environment! Running automatic npm install...');
    try {
        require('child_process').execSync('npm install --legacy-peer-deps', { stdio: 'inherit', cwd: __dirname });
        console.log('✅ Dependencies successfully installed!');
    } catch (installErr) {
        console.error('❌ Failed to run automatic npm install:', installErr.message);
    }
}

const fs = require('fs');
const path = require('path');

// Auto-clear session files on Bad MAC (keeps creds.json)
let lastSessionClear = 0;
function autoSessionClear() {
    const now = Date.now();
    if (now - lastSessionClear < 120000) return; // Rate limit: once per 2 minutes
    lastSessionClear = now;

    const sessionDir = path.join(__dirname, 'session');
    if (!fs.existsSync(sessionDir)) return;

    try {
        const files = fs.readdirSync(sessionDir);
        let cleared = 0;
        for (const file of files) {
            // Only keep creds.json - clear everything else including auth files
            if (file === 'creds.json') continue;
            try {
                fs.unlinkSync(path.join(sessionDir, file));
                cleared++;
            } catch { }
        }
        if (cleared > 0) {
            console.log(`[AUTO-REPAIR] Cleared ${cleared} corrupted session files - Session will re-initialize on next connection`);
            // Force exit so PM2/systemd can restart with clean state
            console.log(`[AUTO-REPAIR] Restarting bot in 3 seconds for clean recovery...`);
            setTimeout(() => {
                process.exit(0);
            }, 3000);
        }
    } catch { }
}

// Stream-level suppression disabled on Koyeb/container platforms to prevent log duplication
// The console.log/error/warn overrides are sufficient for suppressing encryption logs
// On Koyeb, stream-level overrides cause output duplication in the custom logging layer

// Suppress Baileys internal session/prekey/BadMAC logs - AGGRESSIVE suppression
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// Keywords that should be completely suppressed (as Set for faster lookup)
const SUPPRESS_KEYWORDS = new Set([
    'closing session', 'sessionentry', '_chains', 'registrationid', 'pendingprekey',
    'currentratchet', 'indexinfo', 'ephemeralkeypair', 'lastremoteephemeralkey',
    'basekey', 'chainkey', 'chaintype', 'messagekeys', 'signal key',
    'decrypt error', 'failed to decrypt', 'bad mac', 'session error',
    'messagecountererror', 'decrypted message', 'curve25519', 'hkdf-sha256',
    'prekey', 'signedprekey', 'identity key', 'ratchet', 'rootkey', 'noisekey',
    'signedbundle', 'xmppframing', 'sending presence', 'message counter'
]);

const shouldSuppress = (args) => {
    // First, check if any argument is a SessionEntry-like object or Buffer key
    for (const arg of args) {
        if (!arg) continue;

        if (typeof arg === 'object') {
            const name = arg.constructor?.name || '';

            // Direct object type checks
            if (name.includes('SessionEntry') || name.includes('Session') ||
                name.includes('Ratchet') || name.includes('Signal')) {
                return true;
            }

            // Check for session-related properties
            if (arg._chains || arg.currentRatchet || arg.registrationId || arg.pendingPreKey ||
                arg.ephemeralKeyPair || arg.lastRemoteEphemeralKey || arg.rootKey || arg.keyPair ||
                arg.noiseKey || arg.signedPreKey || arg.signedIdentityKey) {
                return true;
            }

            // Suppress large Buffers (likely encryption keys, > 20 bytes)
            if (Buffer.isBuffer(arg) && arg.length > 20) {
                return true;
            }
        }
    }

    // Check string arguments for suppression keywords
    for (const arg of args) {
        if (typeof arg !== 'string') continue;

        const lower = arg.toLowerCase();

        // Check for any suppression keyword
        for (const keyword of SUPPRESS_KEYWORDS) {
            if (lower.includes(keyword)) return true;
        }

        // Suppress things that look like object stringifications
        if (lower.includes('<buffer') || lower.includes('pubkey') || lower.includes('privkey')) {
            return true;
        }
    }

    return false;
};

console.log = (...args) => {
    if (shouldSuppress(args)) return;
    originalConsoleLog.apply(console, args);
};

console.error = (...args) => {
    if (shouldSuppress(args)) {
        // Auto-repair on Bad MAC errors
        const badMacFound = args.some(arg =>
            typeof arg === 'string' && arg.toLowerCase().includes('bad mac')
        );
        if (badMacFound) {
            autoSessionClear();
        }
        return;
    }
    originalConsoleError.apply(console, args);
};

console.warn = (...args) => {
    if (shouldSuppress(args)) return;
    originalConsoleWarn.apply(console, args);
};


require('./config');
require('./settings');

const { Writable } = require('stream');

// Create a null stream that discards all output for Pino
const nullStream = new Writable({
    write() {} // Do nothing - discard all output
});

const { Boom } = require('@hapi/boom');
const chalk = require('chalk');
const FileType = require('file-type');
const syntaxerror = require('syntax-error');
const axios = require('axios');
const PhoneNumber = require('awesome-phonenumber');
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif');
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    Browsers,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys");
const NodeCache = require("node-cache");
const pino = require("pino");
const readline = require("readline");
const { parsePhoneNumber } = require("libphonenumber-js");
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics');
const { rmSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');

const store = require('./lib/lightweight_store');
const SaveCreds = require('./lib/session');
const { app, server, PORT } = require('./lib/server');
const { printLog } = require('./lib/print');
const isOwnerOrSudo = require('./lib/isOwner');
const {
    handleMessages,
    handleGroupParticipantUpdate,
    handleStatus,
    handleCall
} = require('./lib/messageHandler');

const settings = require('./settings');
const commandHandler = require('./lib/commandHandler');

store.readFromFile();
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000);

commandHandler.loadCommands();
// console.log(chalk.greenBright(`✅ Loaded ${commandHandler.commands.size} Plugins`));

setInterval(() => {
    if (global.gc) {
        global.gc();
        console.log('🧹 Garbage collection completed');
    }
}, 60_000);

setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024;
    if (used > 400) {
        if (global.gc) global.gc();
        if (store && typeof store.cleanupData === 'function') store.cleanupData();
        console.log(chalk.yellow('⚠️ RAM high (>400MB), executed emergency GC and store cleanup'));
    }
}, 30_000);

let phoneNumber = global.PAIRING_NUMBER || process.env.PAIRING_NUMBER || "923051391005";
let owner = JSON.parse(fs.readFileSync('./data/owner.json'));

global.botname = process.env.BOT_NAME || "PGWIZ-MD";
global.themeemoji = "•";

const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code");
const useMobile = process.argv.includes("--mobile");

let rl = null;
if (process.stdin.isTTY && !process.env.PAIRING_NUMBER) {
    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

const question = (text) => {
    if (rl && !rl.closed) {
        return new Promise((resolve) => rl.question(text, resolve));
    } else {
        return Promise.resolve(settings.ownerNumber || phoneNumber);
    }
};

process.on('exit', () => {
    if (rl && !rl.closed) {
        rl.close();
    }
});

process.on('SIGINT', () => {
    if (rl && !rl.closed) {
        rl.close();
    }
    process.exit(0);
});

function ensureSessionDirectory() {
    const sessionPath = path.join(__dirname, 'session');
    if (!existsSync(sessionPath)) {
        mkdirSync(sessionPath, { recursive: true });
    }
    return sessionPath;
}

function hasValidSession() {
    try {
        const credsPath = path.join(__dirname, 'session', 'creds.json');

        if (!existsSync(credsPath)) {
            return false;
        }

        const fileContent = fs.readFileSync(credsPath, 'utf8');
        if (!fileContent || fileContent.trim().length === 0) {
            printLog('warning', 'creds.json exists but is empty');
            return false;
        }

        try {
            const creds = JSON.parse(fileContent);
            if (!creds.noiseKey || !creds.signedIdentityKey || !creds.signedPreKey) {
                printLog('warning', 'creds.json is missing required fields');
                return false;
            }

            // If we have valid keys and a me.id, accept the session
            // Baileys will handle registration during connection
            if (creds.me && creds.me.id) {
                printLog('success', `Session found for ${creds.me.id} (registered: ${creds.registered})`);
                return true;
            }

            if (creds.registered === false) {
                printLog('warning', 'Session not registered and no me.id - will need pairing');
                return false;
            }

            printLog('success', 'Valid session credentials found');
            return true;
        } catch (parseError) {
            printLog('warning', 'creds.json contains invalid JSON');
            return false;
        }
    } catch (error) {
        printLog('error', `Error checking session validity: ${error.message}`);
        return false;
    }
}

async function getPresenceConfig() {
    if (typeof global.alwaysOnlineState === 'boolean') {
        return { alwaysOnline: global.alwaysOnlineState };
    }
    try {
        const existing = await store.getSetting('global', 'presenceConfig');
        if (existing && typeof existing.alwaysOnline === 'boolean') {
            global.alwaysOnlineState = existing.alwaysOnline;
            return { alwaysOnline: existing.alwaysOnline };
        }
    } catch (e) {}

    const envVal = process.env.ALWAYS_ONLINE || process.env.ALWAYS_ONLINE_PRESENCE;
    const isEn = (envVal !== undefined && String(envVal).trim() !== '')
        ? (String(envVal).toLowerCase() === 'true' || String(envVal) === '1' || String(envVal).toLowerCase() === 'on')
        : (settings.alwaysOnline ?? false);
    global.alwaysOnlineState = isEn;
    return { alwaysOnline: isEn };
}

async function isAlwaysOnlineEnabled() {
    try {
        const config = await getPresenceConfig();
        return !!config.alwaysOnline;
    } catch {
        return false;
    }
}

async function initializeSession() {
    ensureSessionDirectory();

    const txt = global.SESSION_ID || process.env.SESSION_ID;

    if (!txt) {
        printLog('warning', 'No SESSION_ID found in environment variables');
        if (hasValidSession()) {
            printLog('success', 'Existing session found. Using saved credentials');
            return true;
        }
        printLog('warning', 'No existing session found. Pairing code will be required');
        return false;
    }

    // Always refresh session from service to prevent staleness
    try {
        printLog('info', 'Refreshing session credentials from PGWIZ service...');
        await SaveCreds(txt);
        await delay(1500);

        if (hasValidSession()) {
            printLog('success', 'Session refreshed and verified');
            await delay(500);
            return true;
        } else {
            printLog('error', 'Session file not valid after refresh');
            return false;
        }
    } catch (error) {
        printLog('error', `Error refreshing session: ${error.message}`);
        // Fall back to existing session if available
        if (hasValidSession()) {
            printLog('warning', 'Using existing session (refresh failed)');
            return true;
        }
        return false;
    }
}

if (!server.listening) {
    server.listen(PORT, '0.0.0.0', () => {
        printLog('success', `Server listening on 0.0.0.0:${PORT}`);
    });
}

async function startPgwizDev() {
    try {
        let { version, isLatest } = await fetchLatestBaileysVersion();

        ensureSessionDirectory();
        await delay(1000);

        const { useSQLiteAuthState } = require('./lib/sqliteAuthState');
        const { state, saveCreds } = await useSQLiteAuthState();
        // Create retry counter cache with short TTL (10 seconds) so old messages don't stay cached
        const msgRetryCounterCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

        const hasRegisteredCreds = state.creds && state.creds.registered !== undefined;
        printLog('info', `Credentials loaded. Registered: ${state.creds?.registered || false}`);

        const ghostMode = await store.getSetting('global', 'stealthMode');
        const isGhostActive = ghostMode && ghostMode.enabled;

        if (isGhostActive) {
            printLog('info', '👻 STEALTH MODE IS ACTIVE - Starting in stealth mode');
        }

        const pgwizSocket = makeWASocket({
            version,
            logger: pino({ level: 'silent' }, nullStream), // Silent logger with null stream
            printQRInTerminal: !pairingCode,
            browser: Browsers.ubuntu('Chrome'), // Better for Linux/PM2 servers
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }, nullStream)),
            },
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => false, // Disable history sync for real-time only
            retryRequestDelayMs: 2500,
            maxMsgRetryCount: 3, // Reduce retry delay from 5s to 2s
            fireInitQueries: false,
            getMessage: async (key) => {
                try {
                    // Add a 3 second timeout so we don't get stuck waiting for old messages
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('timeout')), 3000)
                    );

                    let jid = jidNormalizedUser(key.remoteJid);
                    const loadPromise = store.loadMessage(jid, key.id);
                    const msg = await Promise.race([loadPromise, timeoutPromise]);
                    return msg?.message || "";
                } catch (err) {
                    // If timeout or error, return empty string - Baileys will skip this message
                    return "";
                }
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000, // Aggressive keep-alive for stability
        });

        // Expose bot instance globally for /ping endpoint
        global.botInstance = pgwizSocket;

        
        const originalSendNode = pgwizSocket.sendNode;
        pgwizSocket.sendNode = async function (node) {
            if (node && node.tag === 'presence') {
                try {
                    const ghostMode = await store.getSetting('global', 'stealthMode');
                    if (ghostMode && ghostMode.enabled) return;

                    const isOnline = await isAlwaysOnlineEnabled();
                    if (!isOnline) {
                        if (!node.attrs?.type || node.attrs?.type === 'available') {
                            node.attrs = { ...node.attrs, type: 'unavailable' };
                        }
                    }
                } catch {}
            }
            return originalSendNode.call(this, node);
        };

        const originalSendPresenceUpdate = pgwizSocket.sendPresenceUpdate;
        const originalReadMessages = pgwizSocket.readMessages;
        const originalSendReceipt = pgwizSocket.sendReceipt;
        const originalSendReadReceipt = pgwizSocket.sendReadReceipt;

        pgwizSocket.sendPresenceUpdate = async function (...args) {
            const [presenceType, jid] = args;
            const ghostMode = await store.getSetting('global', 'stealthMode');
            if (ghostMode && ghostMode.enabled) return;

            const alwaysOnline = await isAlwaysOnlineEnabled();
            if (alwaysOnline) {
                const state = String(presenceType || '').toLowerCase();
                if (state === 'unavailable') return; // Stay online when alwaysOnline is enabled
                if (state === 'paused') {
                    return originalSendPresenceUpdate.call(this, 'available', jid);
                }
                return originalSendPresenceUpdate.apply(this, args);
            } else {
                const state = String(presenceType || '').toLowerCase();
                if (state === 'available') {
                    // Drop available updates when alwaysOnline is disabled so commands don't force online
                    return;
                }
                if (state === 'paused') {
                    return originalSendPresenceUpdate.call(this, 'unavailable', jid);
                }
                return originalSendPresenceUpdate.apply(this, args);
            }
        };

        pgwizSocket.readMessages = async function (...args) {
            const ghostMode = await store.getSetting('global', 'stealthMode');
            if (ghostMode && ghostMode.enabled) {
                return;
            }
            return originalReadMessages.apply(this, args);
        };

        if (originalSendReceipt) {
            pgwizSocket.sendReceipt = async function (...args) {
                const ghostMode = await store.getSetting('global', 'stealthMode');
                if (ghostMode && ghostMode.enabled) {
                    return;
                }
                return originalSendReceipt.apply(this, args);
            };
        }

        if (originalSendReadReceipt) {
            pgwizSocket.sendReadReceipt = async function (...args) {
                const ghostMode = await store.getSetting('global', 'stealthMode');
                if (ghostMode && ghostMode.enabled) {
                    return;
                }
                return originalSendReadReceipt.apply(this, args);
            };
        }

        const originalQuery = pgwizSocket.query;
        pgwizSocket.query = async function (node, ...args) {
            const ghostMode = await store.getSetting('global', 'stealthMode');
            if (ghostMode && ghostMode.enabled) {
                if (node && node.tag === 'receipt') {
                    return;
                }
                if (node && node.attrs && (node.attrs.type === 'read' || node.attrs.type === 'read-self')) {
                    return;
                }
            }
            return originalQuery.apply(this, [node, ...args]);
        };

        pgwizSocket.isGhostMode = async () => {
            const ghostMode = await store.getSetting('global', 'stealthMode');
            return ghostMode && ghostMode.enabled;
        };

        pgwizSocket.ev.on('creds.update', saveCreds);
        store.bind(pgwizSocket.ev);

        const processedMessageKeys = new Set();
        setInterval(() => {
            if (processedMessageKeys.size > 5000) processedMessageKeys.clear();
        }, 60000);

        pgwizSocket.ev.on('messages.upsert', async (chatUpdate) => {
            try {
                // Only process real-time messages, ignore history/append
                if (chatUpdate.type !== 'notify' && chatUpdate.type !== 'append') return;

                // Process any status updates in the batch immediately (never drop batch/burst statuses)
                const statusMessages = (chatUpdate.messages || []).filter(m => m?.key?.remoteJid === 'status@broadcast');
                if (statusMessages.length > 0) {
                    handleStatus(pgwizSocket, { type: chatUpdate.type, messages: statusMessages }).catch(err => printLog('error', `AutoStatus Error: ${err.message}`));
                }

                // Filter out statuses from normal command processing
                const normalMessages = (chatUpdate.messages || []).filter(m => m?.key?.remoteJid !== 'status@broadcast');
                if (normalMessages.length === 0) return;

                const mek = normalMessages[0];
                if (!mek?.message || !mek.key?.id) return;

                const msgDedupeKey = `${mek.key.remoteJid || ''}_${mek.key.id}_${mek.key.fromMe ? '1' : '0'}`;
                if (processedMessageKeys.has(msgDedupeKey)) return;
                processedMessageKeys.add(msgDedupeKey);

                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage')
                    ? mek.message.ephemeralMessage.message
                    : mek.message;

                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;

                const botMode = await store.getBotMode();
                const isGroup = mek.key?.remoteJid?.endsWith('@g.us');
                const senderJid = mek.key?.participant || mek.key?.remoteJid;
                const checkOwnerOrSudo = isOwnerOrSudo;
                const isOwnerMsg = mek.key?.fromMe || (senderJid && await checkOwnerOrSudo(senderJid, pgwizSocket, mek.key?.remoteJid).catch(() => false));

                if (!isOwnerMsg) {
                    if (botMode === 'private' || botMode === 'self') return;
                    if (botMode === 'groups' && !isGroup) return;
                    if (botMode === 'inbox' && isGroup) return;
                }

                // Preserved msgRetryCounterCache to prevent infinite message retry loops

                try {
                    await handleMessages(pgwizSocket, chatUpdate);
                } catch (err) {
                    printLog('error', `Error in handleMessages: ${err.message}`);
                    if (mek.key && mek.key.remoteJid) {
                        await pgwizSocket.sendMessage(mek.key.remoteJid, {
                            text: '❌ An error occurred while processing your message.',
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: settings.newsletterJid || '120363179639202475@newsletter',
                                    newsletterName: settings.newsletterName || 'PGWIZ-MD',
                                    serverMessageId: -1
                                }
                            }
                        }).catch(console.error);
                    }
                }
            } catch (err) {
                printLog('error', `Error in messages.upsert: ${err.message}`);
            }
        });

        pgwizSocket.decodeJid = (jid) => {
            if (!jid) return jid;
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {};
                return decode.user && decode.server && decode.user + '@' + decode.server || jid;
            } else return jid;
        };

        pgwizSocket.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = pgwizSocket.decodeJid(contact.id);
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify };
            }
        });

        pgwizSocket.getName = (jid, withoutContact = false) => {
            id = pgwizSocket.decodeJid(jid);
            withoutContact = pgwizSocket.withoutContact || withoutContact;
            let v;
            if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
                v = store.contacts[id] || {};
                if (!(v.name || v.subject)) v = pgwizSocket.groupMetadata(id) || {};
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'));
            });
            else v = id === '0@s.whatsapp.net' ? {
                id,
                name: 'WhatsApp'
            } : id === pgwizSocket.decodeJid(pgwizSocket.user.id) ?
                pgwizSocket.user :
                (store.contacts[id] || {});
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international');
        };

        pgwizSocket.public = true;
        pgwizSocket.serializeM = (m) => smsg(pgwizSocket, m, store);

        const isRegistered = state.creds?.registered === true;
        const hasValidMe = state.creds?.me?.id ? true : false;

        // If we have me.id (from session service), trust it and attempt connection
        // No need for manual pairing - Baileys will handle registration during connection
        if (hasValidMe) {
            printLog('info', `Session has me.id: ${state.creds.me.id} (registered: ${isRegistered}) - attempting connection...`);
            if (rl && !rl.closed) {
                rl.close();
                rl = null;
            }
        } else if (pairingCode) {
            // Only prompt for pairing if we have NO me.id at all (fresh start)
            if (useMobile) throw new Error('Cannot use pairing code with mobile api');

            printLog('warning', 'No session found. Pairing code required');

            let phoneNumberInput;
            if (!!global.phoneNumber) {
                phoneNumberInput = global.phoneNumber;
            } else if (process.env.PAIRING_NUMBER) {
                phoneNumberInput = process.env.PAIRING_NUMBER;
                printLog('info', `Using phone number from environment: ${phoneNumberInput}`);
            } else if (rl && !rl.closed) {
                phoneNumberInput = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number 😍\nFormat: 6281376552730 (without + or spaces) : `)));
            } else {
                phoneNumberInput = phoneNumber;
                printLog('info', `Using default phone number: ${phoneNumberInput}`);
            }

            phoneNumberInput = phoneNumberInput.replace(/[^0-9]/g, '');

            const pn = require('awesome-phonenumber');
            if (!pn('+' + phoneNumberInput).isValid()) {
                printLog('error', 'Invalid phone number format');

                if (rl && !rl.closed) {
                    rl.close();
                }
                process.exit(1);
            }

            setTimeout(async () => {
                try {
                    let code = await pgwizSocket.requestPairingCode(phoneNumberInput);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)));
                    printLog('success', `Pairing code generated: ${code}`);

                    if (rl && !rl.closed) {
                        rl.close();
                        rl = null;
                    }
                } catch (error) {
                    printLog('error', `Failed to get pairing code: ${error.message}`);
                }
            }, 3000);
        } else {
            printLog('warning', 'Waiting for connection to establish...');
            if (rl && !rl.closed) {
                rl.close();
                rl = null;
            }
        }

        pgwizSocket.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect, qr } = s;

            if (qr) {
                printLog('info', 'QR Code generated. Please scan with WhatsApp');
            }

            if (connection === 'connecting') {
                printLog('connection', 'Connecting to WhatsApp...');
            }



            if (connection == "open") {
                global.botConnectedTime = Date.now(); // Track connection time for old message filtering
                printLog('success', 'Bot connected successfully!');
                const { startAutoBio } = require('./plugins/a-setbio');
                startAutoBio(pgwizSocket);
                try {
                    const { initAutoClear } = require('./plugins/autoclear');
                    if (typeof initAutoClear === 'function') {
                        initAutoClear(pgwizSocket);
                    }
                } catch (error) {}
                const presenceConfig = await getPresenceConfig();
                if (presenceConfig.alwaysOnline && !(ghostMode && ghostMode.enabled)) {
                    try {
                        await originalSendPresenceUpdate.call(pgwizSocket, 'available');
                        printLog('presence', '🟢 Always-online presence activated');
                    } catch (error) {
                        printLog('warning', `Failed to set initial always-online presence: ${error.message}`);
                    }
                } else if (!ghostMode || !ghostMode.enabled) {
                    try {
                        await originalSendPresenceUpdate.call(pgwizSocket, 'unavailable');
                    } catch (error) {}
                }

                // Single non-stacking presence heartbeat (60s interval to prevent WebSocket congestion)
                if (global.presenceHeartbeatInterval) {
                    clearInterval(global.presenceHeartbeatInterval);
                }
                global.presenceHeartbeatInterval = setInterval(async () => {
                    try {
                        const currentGhostMode = await store.getSetting('global', 'stealthMode');
                        if (currentGhostMode && currentGhostMode.enabled) return;

                        const currentPresenceConfig = await getPresenceConfig();
                        if (currentPresenceConfig && currentPresenceConfig.alwaysOnline) {
                            await originalSendPresenceUpdate.call(pgwizSocket, 'available').catch(() => {});
                        }
                    } catch {}
                }, 60 * 1000);

                const sendStartupMsg = process.env.STARTUP_MESSAGE !== 'false' && process.env.SEND_STARTUP_MESSAGE !== 'false';
                if (sendStartupMsg && !global.hasSentStartupNotification) {
                    global.hasSentStartupNotification = true;
                    try {
                        const botNumber = pgwizSocket.user.id.split(':')[0] + '@s.whatsapp.net';
                        const ghostStatus = (ghostMode && ghostMode.enabled) ? '\n👻 Stealth Mode: ACTIVE' : '';

                        await pgwizSocket.sendMessage(botNumber, {
                            text: `🤖 ${settings.botName || 'PGWIZ-MD'} Connected Successfully!\n\n⏰ Time: ${new Date().toLocaleString()}\n✅ Status: Online and Ready!${ghostStatus}\n\n✅Make sure to join below channel`,
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363179639202475@newsletter',
                                    newsletterName: settings.newsletterName || settings.botName || 'PGWIZ-MD',
                                    serverMessageId: -1
                                }
                            }
                        });

                        // --- Startup debug: send quick health-check to primary owner once per boot ---
                        try {
                            if (Array.isArray(owner) && owner.length) {
                                const primary = owner[0];
                                const ownerJid = primary.includes('@') ? primary : `${primary}@s.whatsapp.net`;

                                global.startupDebug = {
                                    pending: true,
                                    ownerJids: [ownerJid],
                                    startedAt: Date.now(),
                                    expiresAt: Date.now() + 10 * 60 * 1000
                                };

                                await pgwizSocket.sendMessage(ownerJid, {
                                    text: '🤖 Startup check — reply to this message to confirm bot status.\n\nReply with `.menu` to receive the first menu (debug only).',
                                });

                                printLog('info', `Startup debug message sent to ${ownerJid.split('@')[0]}`);
                            }
                        } catch (e) {
                            printLog('error', `Startup debug send failed: ${e.message}`);
                        }

                    } catch (error) {
                        printLog('error', `Failed to send connection message: ${error.message}`);
                    }
                }


                // Verbose startup banner disabled
                // await delay(1999);
                // console.log(chalk.yellow(`\n\n                  ${chalk.bold.blue(`[ ${global.botname || 'PGWIZ-MD'} ]`)}\n\n`));
                // console.log(chalk.cyan(`< ================================================== >`));
                // console.log(chalk.magenta(`\n${global.themeemoji || '•'} YT CHANNEL: pgwiz`));
                // console.log(chalk.magenta(`${global.themeemoji || '•'} GITHUB: pgwiz`));
                // console.log(chalk.magenta(`${global.themeemoji || '•'} WA NUMBER: ${owner}`));
                // console.log(chalk.magenta(`${global.themeemoji || '•'} CREDIT: pgwiz`));
                // console.log(chalk.green(`${global.themeemoji || '•'} 🤖 ${settings.botName || 'PGWIZ-MD'} Connected Successfully! ✅`));
                // console.log(chalk.blue(`Bot Version: ${settings.version}`));
                // console.log(chalk.cyan(`Loaded Commands: ${commandHandler.commands.size}`));
                // console.log(chalk.cyan(`Prefixes: ${settings.prefixes.join(', ')}`));
                // console.log(chalk.gray(`Backend: ${store.getStats().backend}`));
                // console.log();
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMsg = String(lastDisconnect?.error?.message || '').toLowerCase();

                printLog('error', `Connection closed - Status: ${statusCode || 'unknown'} (${lastDisconnect?.error?.message || 'Unknown'})`);

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    try {
                        rmSync('./session', { recursive: true, force: true });
                        printLog('warning', 'Session logged out. Please re-authenticate');
                    } catch (error) {
                        printLog('error', `Error deleting session: ${error.message}`);
                    }
                    return;
                }

                if (errorMsg.includes('incorrect private key length') || errorMsg.includes('invalid key') || errorMsg.includes('bad mac')) {
                    printLog('warning', '[AUTO-REPAIR] Corrupted private key detected. Clearing auth cache for clean recovery...');
                    try {
                        const { resetSQLiteAuthState } = require('./lib/sqliteAuthState');
                        resetSQLiteAuthState('incorrect-key-length');
                        rmSync('./session', { recursive: true, force: true });
                    } catch {}
                }

                if (statusCode === 440) {
                    console.log(chalk.bold.redBright('⚠️  SESSION CONFLICT (Status 440)'));
                    console.log(chalk.red('   Another bot instance is currently connected with this SESSION_ID.'));
                    console.log(chalk.red('   Please ensure other running terminals or cloud instances are stopped.'));
                    printLog('connection', 'Reconnecting in 30 seconds...');
                    await delay(30000);
                    startPgwizDev();
                    return;
                }

                const waitTime = 8000;
                printLog('connection', `Reconnecting in ${waitTime/1000} seconds...`);
                await delay(waitTime);
                startPgwizDev();
            }
        });

        pgwizSocket.ev.on('call', async (calls) => {
            await handleCall(pgwizSocket, calls);
        });

        pgwizSocket.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(pgwizSocket, update);
        });

        pgwizSocket.ev.on('status.update', async (status) => {
            await handleStatus(pgwizSocket, status);
        });

        
        return pgwizSocket;
    } catch (error) {
        printLog('error', `Error in startPgwizDev: ${error.message}`);

        if (rl && !rl.closed) {
            rl.close();
            rl = null;
        }

        await delay(5000);
        startPgwizDev();
    }
}


async function main() {
    printLog('info', `Starting ${settings.botName || 'PGWIZ-MD'} BOT...`);

    const sessionReady = await initializeSession();

    if (sessionReady) {
        printLog('success', 'Session initialization complete. Starting bot...');
    } else {
        printLog('warning', 'Session initialization incomplete. Will attempt pairing...');
    }

    await delay(3000);

    startPgwizDev().catch(error => {
        printLog('error', `Fatal error: ${error.message}`);

        if (rl && !rl.closed) {
            rl.close();
        }

        process.exit(1);
    });
}

main();


const customTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(customTemp)) fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

setInterval(() => {
    fs.readdir(customTemp, (err, files) => {
        if (err) return;
        for (const file of files) {
            const filePath = path.join(customTemp, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && Date.now() - stats.mtimeMs > 3 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => { });
                }
            });
        }
    });
    //  console.log('🧹 Temp folder auto-cleaned');
}, 1 * 60 * 60 * 1000);

// Auto-clear session files every 3 minutes to prevent memory leaks and encryption conflicts
setInterval(() => {
    try {
        const sessionDir = path.join(process.cwd(), 'session');
        if (!fs.existsSync(sessionDir)) return;

        const files = fs.readdirSync(sessionDir);
        let clearedCount = 0;

        for (const file of files) {
            if (file === 'creds.json') continue; // Never delete creds
            try {
                fs.unlinkSync(path.join(sessionDir, file));
                clearedCount++;
            } catch { }
        }

        if (clearedCount > 0) {
            console.log(chalk.gray(`🧹 Auto-cleared ${clearedCount} session files`));
        }
    } catch (err) {
        // Silently fail, not critical
    }
}, 3 * 60 * 1000); // Every 3 minutes (2-4 minute range as requested)

// CPU throttling detection and monitoring
setInterval(() => {
    try {
        const os = require('os');
        const cpus = os.cpus();
        if (!cpus || cpus.length === 0) return;

        let totalIdle = 0;
        let totalTick = 0;

        for (const cpu of cpus) {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        }

        const cpuUsage = 100 - ~~(100 * totalIdle / totalTick);

        // Log if CPU is above 85% (significant throttling risk)
        if (cpuUsage > 85) {
            console.warn(chalk.yellow(`⚠️  HIGH CPU USAGE: ${cpuUsage}% - Server may be throttling performance`));
        }

        // Check for system slowness indicators every 2 minutes
        if (!global.cpuMonitor) global.cpuMonitor = { counts: [] };
        global.cpuMonitor.counts.push(cpuUsage);
        if (global.cpuMonitor.counts.length > 10) global.cpuMonitor.counts.shift();

        const avgCpu = global.cpuMonitor.counts.reduce((a, b) => a + b, 0) / global.cpuMonitor.counts.length;
        if (avgCpu > 80 && global.cpuMonitor.counts.length === 10) {
            console.warn(chalk.red(`🔥 SUSTAINED HIGH CPU: ${avgCpu.toFixed(1)}% average - Bot may be CPU-throttled on this server`));
        }
    } catch (err) {
        // Silently ignore CPU monitoring errors
    }
}, 2 * 60 * 1000); // Every 2 minutes

const folders = [
    path.join(__dirname, './lib'),
    path.join(__dirname, './plugins')
];

let totalFiles = 0;
let okFiles = 0;
let errorFiles = 0;

folders.forEach(folder => {
    if (!fs.existsSync(folder)) return;

    fs.readdirSync(folder)
        .filter(file => file.endsWith('.js'))
        .forEach(file => {
            totalFiles++;
            const filePath = path.join(folder, file);

            try {
                const code = fs.readFileSync(filePath, 'utf-8');
                const err = syntaxerror(code, file, {
                    sourceType: 'script',
                    allowAwaitOutsideFunction: true
                });

                if (err) {
                    console.error(chalk.red(`❌ Syntax error in ${filePath}:\n${err}`));
                    errorFiles++;
                } else {
                    okFiles++;
                }
            } catch (e) {
                console.error(chalk.yellow(`⚠️ Cannot read file ${filePath}:\n${e}`));
                errorFiles++;
            }
        });
});

/**
* console.log(chalk.greenBright(`✅ OK files: ${okFiles}`));
* console.log(chalk.redBright(`❌Files with errors: ${errorFiles}\n`));
*/

process.on('uncaughtException', (err) => {
    printLog('error', `Uncaught Exception: ${err.message}`);
    console.error(err.stack);
});

process.on('unhandledRejection', (err) => {
    if (err?.message?.includes('Connection Closed') || err?.output?.statusCode === 428 || err?.message?.includes('rate-overlimit')) return;
    printLog('error', `Unhandled Rejection: ${err?.message || err}`);
    if (err?.stack) console.error(err.stack);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        printLog('error', `Address localhost:${PORT} in use`);
        server.close();
    } else {
        printLog('error', `Server error: ${error.message}`);
    }
});

// NOTE: fs.watchFile re-require removed — caused double startup on Render/PM2.
// Hot-reload is handled by PM2 watch or Render auto-deploy.


