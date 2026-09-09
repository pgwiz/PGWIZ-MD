/**
 * SQLite-based Auth State for Baileys
 * Replaces useMultiFileAuthState with database-backed storage
 * 
 * On first startup, imports creds from session/creds.json (downloaded from session service)
 * All subsequent updates are stored in SQLite.
 * If SQLite native bindings are unavailable (e.g. Heroku/Render/Koyeb buildpacks without build-essential),
 * falls back seamlessly to multi-file session storage with full buffer normalization and registered=true enforcement.
 */

const path = require('path');
const fs = require('fs');
const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

const SQLITE_URL = process.env.DB_URL || path.join(__dirname, '..', 'data', 'baileys_store.db');

let Database = null;
let db = null;
let forceResetApplied = false;

const BUFFER_FIELD_NAMES = new Set(['private', 'public', 'signature', 'privKey', 'pubKey']);

function looksLikeBase64(value) {
    return typeof value === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length >= 16;
}

function toBuffer(value) {
    if (!value) return value;

    if (Buffer.isBuffer(value)) {
        if (value.length === 44 || value.length === 88 || value.length > 32) {
            try {
                const str = value.toString('utf8').trim();
                if (looksLikeBase64(str)) {
                    const decoded = Buffer.from(str, 'base64');
                    if (decoded.length === 32 || decoded.length === 64) {
                        return decoded;
                    }
                }
            } catch {}
        }
        return value;
    }

    if (typeof value === 'string') {
        const cleaned = value.trim().replace(/\s/g, '');
        if (looksLikeBase64(cleaned)) {
            try {
                return Buffer.from(cleaned, 'base64');
            } catch {}
        }
    }

    if (value && typeof value === 'object') {
        // CASE 1: Session service format: { type: 'Buffer', data: "Base64String..." }
        if (value.type === 'Buffer' && typeof value.data === 'string') {
            try {
                const b = Buffer.from(value.data.trim(), 'base64');
                if (b.length > 0) return b;
            } catch {}
        }

        // CASE 2: { type: 'Buffer', data: [...] } or { type: 'Uint8Array', data: [...] }
        if ((value.type === 'Buffer' || value.type === 'Uint8Array') && Array.isArray(value.data)) {
            return toBuffer(Buffer.from(value.data));
        }
    }

    if (Array.isArray(value) && value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        return toBuffer(Buffer.from(value));
    }

    if (looksLikeBase64(value)) {
        try {
            const normalizedInput = String(value).trim().replace(/\s/g, '');
            const parsed = Buffer.from(normalizedInput, 'base64');
            if (parsed.length > 0) {
                return parsed;
            }
        } catch {
            // Keep original value when decoding fails.
        }
    }

    return value;
}

function normalizeBinaryFields(target, depth = 0) {
    if (!target || typeof target !== 'object' || depth > 8) {
        return { value: target, changed: false };
    }

    if (Buffer.isBuffer(target)) {
        const converted = toBuffer(target);
        return { value: converted, changed: converted !== target };
    }

    if (Array.isArray(target)) {
        let changed = false;
        for (let i = 0; i < target.length; i++) {
            const result = normalizeBinaryFields(target[i], depth + 1);
            if (result.changed) {
                target[i] = result.value;
                changed = true;
            }
        }
        return { value: target, changed };
    }

    const directBuffer = toBuffer(target);
    if (Buffer.isBuffer(directBuffer) && directBuffer.length <= 64) {
        return { value: directBuffer, changed: true };
    }

    let changed = false;

    for (const [key, rawValue] of Object.entries(target)) {
        if (rawValue === null || rawValue === undefined) continue;

        if (BUFFER_FIELD_NAMES.has(key)) {
            const converted = toBuffer(rawValue);
            if (converted !== rawValue) {
                target[key] = converted;
                changed = true;
                continue;
            }
        }

        if (typeof rawValue === 'object') {
            const result = normalizeBinaryFields(rawValue, depth + 1);
            if (result.changed) {
                target[key] = result.value;
                changed = true;
            }
        }
    }

    return { value: target, changed };
}

function normalizeCredsForUse(rawCreds) {
    if (!rawCreds || typeof rawCreds !== 'object') {
        return { creds: null, changed: false, valid: false, issues: ['credentials payload is empty or invalid'] };
    }

    const creds = rawCreds;
    const issues = [];
    let changed = false;

    const enforceBufferField = (container, fieldName, expectedLen, label) => {
        if (!container || typeof container !== 'object') {
            issues.push(`${label} missing`);
            return;
        }

        const before = container[fieldName];
        let after = toBuffer(before);

        if (Buffer.isBuffer(after) && expectedLen && after.length !== expectedLen) {
            try {
                const str = after.toString('utf8').trim();
                if (looksLikeBase64(str)) {
                    const reDecoded = Buffer.from(str, 'base64');
                    if (reDecoded.length === expectedLen) {
                        after = reDecoded;
                    }
                }
            } catch {}
        }

        if (after !== before) {
            container[fieldName] = after;
            changed = true;
        }

        if (!Buffer.isBuffer(container[fieldName])) {
            issues.push(`${label} is not a Buffer`);
            return;
        }

        if (expectedLen && container[fieldName].length !== expectedLen) {
            issues.push(`${label} length=${container[fieldName].length}, expected=${expectedLen}`);
        }
    };

    enforceBufferField(creds.noiseKey, 'private', 32, 'noiseKey.private');
    enforceBufferField(creds.noiseKey, 'public', 32, 'noiseKey.public');
    enforceBufferField(creds.signedIdentityKey, 'private', 32, 'signedIdentityKey.private');
    enforceBufferField(creds.signedIdentityKey, 'public', 32, 'signedIdentityKey.public');

    if (!creds.signedPreKey || typeof creds.signedPreKey !== 'object') {
        issues.push('signedPreKey missing');
    } else {
        enforceBufferField(creds.signedPreKey.keyPair, 'private', 32, 'signedPreKey.keyPair.private');
        enforceBufferField(creds.signedPreKey.keyPair, 'public', 32, 'signedPreKey.keyPair.public');
        enforceBufferField(creds.signedPreKey, 'signature', 64, 'signedPreKey.signature');
    }

    if (creds.advSecretKey && typeof creds.advSecretKey !== 'string') {
        const converted = toBuffer(creds.advSecretKey);
        if (Buffer.isBuffer(converted)) {
            creds.advSecretKey = converted.toString('base64');
            changed = true;
        }
    }

    if (creds.me && creds.me.id) {
        if (creds.registered !== true) {
            creds.registered = true;
            changed = true;
        }
    }

    return {
        creds,
        changed,
        valid: issues.length === 0,
        issues
    };
}

function clearAuthTables(sqlite, reason = '') {
    sqlite.prepare(`DELETE FROM auth_keys`).run();
    sqlite.prepare(`DELETE FROM auth_creds WHERE id = 1`).run();
    const suffix = reason ? ` (${reason})` : '';
    console.warn(`[AUTH] Cleared SQLite auth state${suffix}`);
}

function resetSQLiteAuthState(reason = 'manual-reset') {
    const sqlite = getDb();
    if (sqlite) {
        clearAuthTables(sqlite, reason);
    }
}

function getDb() {
    if (db) return db;

    try {
        Database = require('better-sqlite3');
        const dir = path.dirname(SQLITE_URL);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        db = new Database(SQLITE_URL);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');

        // Create auth tables
        db.prepare(`
            CREATE TABLE IF NOT EXISTS auth_creds (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL
            )
        `).run();

        db.prepare(`
            CREATE TABLE IF NOT EXISTS auth_keys (
                key_type TEXT NOT NULL,
                key_id TEXT NOT NULL,
                data TEXT NOT NULL,
                PRIMARY KEY (key_type, key_id)
            )
        `).run();

        console.log('[AUTH] SQLite auth state initialized');
        return db;
    } catch (e) {
        console.warn('[AUTH] SQLite native bindings unavailable:', e.message);
        return null;
    }
}

/**
 * Import creds from session/creds.json file into SQLite
 */
function importCredsFromFile(forceClearKeys = false) {
    const credsPath = path.join(__dirname, '..', 'session', 'creds.json');

    if (!fs.existsSync(credsPath)) {
        return null;
    }

    try {
        const fileContent = fs.readFileSync(credsPath, 'utf8');
        let creds;

        try {
            creds = JSON.parse(fileContent, BufferJSON.reviver);
        } catch {
            creds = JSON.parse(fileContent);
        }

        const normalized = normalizeCredsForUse(creds);
        if (!normalized.valid) {
            console.error(`[AUTH] Session creds are invalid: ${normalized.issues.join('; ')}`);
            return null;
        }

        // Save to SQLite
        const sqlite = getDb();
        if (sqlite) {
            if (forceClearKeys) {
                sqlite.prepare(`DELETE FROM auth_keys`).run();
                console.log('[AUTH] Cleared existing auth_keys for new session identity');
            }

            const credsJson = JSON.stringify(normalized.creds, BufferJSON.replacer);
            sqlite.prepare(`INSERT OR REPLACE INTO auth_creds (id, data) VALUES (1, ?)`).run(credsJson);

            if (normalized.changed) {
                console.log('[AUTH] Imported and normalized creds from session file to SQLite');
            } else {
                console.log('[AUTH] Imported creds from session file to SQLite');
            }
        }

        return normalized.creds;
    } catch (e) {
        console.error('[AUTH] Error importing creds from file:', e.message);
        return null;
    }
}

/**
 * Fallback multi-file auth state for buildpacks or container environments without SQLite native addons
 */
async function fallbackMultiFileAuth(sessionDir) {
    const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    // Pre-normalize creds.json if present
    const credsPath = path.join(sessionDir, 'creds.json');
    if (fs.existsSync(credsPath)) {
        try {
            const rawContent = fs.readFileSync(credsPath, 'utf8');
            let parsed;
            try {
                parsed = JSON.parse(rawContent, BufferJSON.reviver);
            } catch {
                parsed = JSON.parse(rawContent);
            }
            const normalized = normalizeCredsForUse(parsed);
            if (normalized.valid && (normalized.changed || normalized.creds.registered !== true)) {
                if (normalized.creds.me && normalized.creds.me.id) {
                    normalized.creds.registered = true;
                }
                fs.writeFileSync(credsPath, JSON.stringify(normalized.creds, BufferJSON.replacer));
                console.log('[AUTH] Normalized & verified creds.json for multi-file storage');
            }
        } catch (e) {
            console.error('[AUTH] Multi-file creds pre-normalization error:', e.message);
        }
    }

    const authState = await useMultiFileAuthState(sessionDir);
    if (authState.state && authState.state.creds) {
        const normalized = normalizeCredsForUse(authState.state.creds);
        if (normalized.valid) {
            authState.state.creds = normalized.creds;
        }
        if (authState.state.creds.me && authState.state.creds.me.id && authState.state.creds.registered !== true) {
            authState.state.creds.registered = true;
        }
    }

    const originalSaveCreds = authState.saveCreds;
    authState.saveCreds = async () => {
        if (authState.state.creds && authState.state.creds.me && authState.state.creds.me.id) {
            authState.state.creds.registered = true;
        }
        return await originalSaveCreds();
    };

    return authState;
}

/**
 * SQLite-based auth state (production-ready replacement for useMultiFileAuthState)
 */
async function useSQLiteAuthState() {
    let sqlite;
    const sessionDir = path.join(__dirname, '..', 'session');

    try {
        sqlite = getDb();
        if (!sqlite) throw new Error('SQLite database instance is null');
    } catch (err) {
        console.warn(`[AUTH] SQLite native bindings unavailable (${err.message}). Falling back to standard multi-file session storage...`);
        return await fallbackMultiFileAuth(sessionDir);
    }

    try {
        const shouldForceReset = String(process.env.FORCE_SESSION_RESET || '').toLowerCase() === 'true';

        if (shouldForceReset && !forceResetApplied) {
            clearAuthTables(sqlite, 'FORCE_SESSION_RESET=true');
            forceResetApplied = true;
        }

        // Try to load creds from SQLite first
        let creds = null;
        let credsRow = null;
        try {
            credsRow = sqlite.prepare(`SELECT data FROM auth_creds WHERE id = 1`).get();
        } catch {}

        if (credsRow) {
            try {
                creds = JSON.parse(credsRow.data, BufferJSON.reviver);

                const normalized = normalizeCredsForUse(creds);
                if (!normalized.valid) {
                    console.error(`[AUTH] SQLite creds are invalid: ${normalized.issues.join('; ')}`);
                    clearAuthTables(sqlite, 'invalid-credentials');
                    creds = null;
                } else {
                    creds = normalized.creds;
                    if (normalized.changed) {
                        const repairedCredsJson = JSON.stringify(creds, BufferJSON.replacer);
                        sqlite.prepare(`INSERT OR REPLACE INTO auth_creds (id, data) VALUES (1, ?)`).run(repairedCredsJson);
                        console.warn('[AUTH] Normalized credential buffers from SQLite');
                    }
                }
            } catch (e) {
                console.error('[AUTH] Error parsing SQLite creds:', e.message);
                clearAuthTables(sqlite, 'corrupted-credentials');
                creds = null;
            }
        }

        // If no valid creds in SQLite, import from session/creds.json
        if (!creds) {
            creds = importCredsFromFile(true);
        } else {
            // Check if file has a newer or different session
            const fileCreds = importCredsFromFile(false);
            if (fileCreds && fileCreds.me && creds.me) {
                if (fileCreds.me.id && creds.me.id && fileCreds.me.id !== creds.me.id) {
                    console.log(`[AUTH] Session mismatch detected! File: ${fileCreds.me.id} vs SQLite: ${creds.me.id}. Re-importing session file...`);
                    creds = importCredsFromFile(true);
                }
            }
        }

        // If still no creds, initialize fresh
        if (!creds) {
            console.log('[AUTH] Initializing fresh credentials');
            creds = initAuthCreds();
            const credsJson = JSON.stringify(creds, BufferJSON.replacer);
            sqlite.prepare(`INSERT OR REPLACE INTO auth_creds (id, data) VALUES (1, ?)`).run(credsJson);
        }

        // Ensure registered flag is preserved if user exists
        if (creds.me && creds.me.id && creds.registered !== true) {
            creds.registered = true;
            const credsJson = JSON.stringify(creds, BufferJSON.replacer);
            sqlite.prepare(`INSERT OR REPLACE INTO auth_creds (id, data) VALUES (1, ?)`).run(credsJson);
        }

        const saveCreds = async () => {
            try {
                const normalized = normalizeCredsForUse(creds);
                creds = normalized.creds;

                const credsJson = JSON.stringify(creds, BufferJSON.replacer);
                sqlite.prepare(`INSERT OR REPLACE INTO auth_creds (id, data) VALUES (1, ?)`).run(credsJson);

                // Also backup to file
                const credsPath = path.join(sessionDir, 'creds.json');
                if (!fs.existsSync(sessionDir)) {
                    fs.mkdirSync(sessionDir, { recursive: true });
                }
                fs.writeFileSync(credsPath, credsJson);
            } catch (err) {
                console.error('[AUTH] Failed to save creds:', err.message);
            }
        };

        return {
            state: {
                creds,
                keys: {
                    get: async (type, ids) => {
                        const data = {};
                        for (const id of ids) {
                            try {
                                const row = sqlite.prepare(`SELECT data FROM auth_keys WHERE key_type = ? AND key_id = ?`).get(type, id);
                                if (!row) continue;

                                let value = JSON.parse(row.data, BufferJSON.reviver);
                                const normalized = normalizeBinaryFields(value);
                                value = normalized.value;

                                if (type === 'app-state-sync-key' && value) {
                                    value = proto.Message.AppStateSyncKeyData.fromObject(value);
                                }
                                data[id] = value;
                            } catch (e) {
                                console.error(`[AUTH] Error parsing key ${type}:${id}:`, e.message);
                            }
                        }
                        return data;
                    },
                    set: async (data) => {
                        try {
                            const insertStmt = sqlite.prepare(`INSERT OR REPLACE INTO auth_keys (key_type, key_id, data) VALUES (?, ?, ?)`);
                            const deleteStmt = sqlite.prepare(`DELETE FROM auth_keys WHERE key_type = ? AND key_id = ?`);

                            for (const category in data) {
                                for (const id in data[category]) {
                                    const value = data[category][id];
                                    if (value) {
                                        const normalized = normalizeBinaryFields(value);
                                        insertStmt.run(category, id, JSON.stringify(normalized.value, BufferJSON.replacer));
                                    } else {
                                        deleteStmt.run(category, id);
                                    }
                                }
                            }
                        } catch (err) {
                            console.error('[AUTH] Keys set error:', err.message);
                        }
                    }
                }
            },
            saveCreds
        };
    } catch (err) {
        console.warn(`[AUTH] SQLite operation error (${err.message}). Falling back to multi-file session...`);
        return await fallbackMultiFileAuth(sessionDir);
    }
}

module.exports = { useSQLiteAuthState, resetSQLiteAuthState };
