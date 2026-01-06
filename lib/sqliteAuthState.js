/**
 * SQLite-based Auth State for Baileys
 * Replaces useMultiFileAuthState with database-backed storage
 * 
 * On first startup, imports creds from session/creds.json (downloaded from session service)
 * All subsequent updates are stored in SQLite
 */

const path = require('path');
const fs = require('fs');
const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

const SQLITE_URL = process.env.DB_URL || path.join(__dirname, '..', 'baileys_store.db');

let Database = null;
let db = null;

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
        console.error('[AUTH] SQLite init error:', e.message);
        throw e;
    }
}

/**
 * Import creds from session/creds.json file into SQLite
 */
function importCredsFromFile() {
    const credsPath = path.join(__dirname, '..', 'session', 'creds.json');

    if (!fs.existsSync(credsPath)) {
        return null;
    }

    try {
        const fileContent = fs.readFileSync(credsPath, 'utf8');
        const creds = JSON.parse(fileContent);

        // Save to SQLite
        const sqlite = getDb();
        const credsJson = JSON.stringify(creds, BufferJSON.replacer);
        sqlite.prepare(`INSERT OR REPLACE INTO auth_creds (id, data) VALUES (1, ?)`).run(credsJson);

        console.log('[AUTH] Imported creds from session file to SQLite');
        return creds;
    } catch (e) {
        console.error('[AUTH] Error importing creds from file:', e.message);
        return null;
    }
}

/**
 * SQLite-based auth state (production-ready replacement for useMultiFileAuthState)
 */
async function useSQLiteAuthState() {
    const sqlite = getDb();

    // Try to load creds from SQLite first
    let creds = null;
    const credsRow = sqlite.prepare(`SELECT data FROM auth_creds WHERE id = 1`).get();

    if (credsRow) {
        try {
            creds = JSON.parse(credsRow.data, BufferJSON.reviver);
            console.log('[AUTH] Loaded creds from SQLite');
        } catch (e) {
            console.error('[AUTH] Error parsing creds from SQLite:', e.message);
        }
    }

    // If no creds in SQLite, try to import from session file
    if (!creds) {
        creds = importCredsFromFile();
    }

    // If still no creds, initialize fresh
    if (!creds) {
        creds = initAuthCreds();
        console.log('[AUTH] Initialized fresh credentials');
    }

    const saveCreds = () => {
        try {
            const credsJson = JSON.stringify(creds, BufferJSON.replacer);
            sqlite.prepare(`INSERT OR REPLACE INTO auth_creds (id, data) VALUES (1, ?)`).run(credsJson);
        } catch (e) {
            console.error('[AUTH] Error saving creds:', e.message);
        }
    };

    return {
        state: {
            creds,
            keys: {
                get: (type, ids) => {
                    const data = {};
                    const stmt = sqlite.prepare(`SELECT key_id, data FROM auth_keys WHERE key_type = ? AND key_id IN (${ids.map(() => '?').join(',')})`);
                    const rows = stmt.all(type, ...ids);

                    for (const row of rows) {
                        try {
                            let value = JSON.parse(row.data, BufferJSON.reviver);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[row.key_id] = value;
                        } catch (e) {
                            console.error(`[AUTH] Error parsing key ${type}:${row.key_id}:`, e.message);
                        }
                    }

                    return data;
                },
                set: async (data) => {
                    const insertStmt = sqlite.prepare(`INSERT OR REPLACE INTO auth_keys (key_type, key_id, data) VALUES (?, ?, ?)`);
                    const deleteStmt = sqlite.prepare(`DELETE FROM auth_keys WHERE key_type = ? AND key_id = ?`);

                    const insertMany = sqlite.transaction((items) => {
                        for (const item of items) {
                            if (item.action === 'insert') {
                                insertStmt.run(item.type, item.id, item.data);
                            } else {
                                deleteStmt.run(item.type, item.id);
                            }
                        }
                    });

                    const items = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            if (value) {
                                items.push({
                                    action: 'insert',
                                    type: category,
                                    id,
                                    data: JSON.stringify(value, BufferJSON.replacer)
                                });
                            } else {
                                items.push({
                                    action: 'delete',
                                    type: category,
                                    id
                                });
                            }
                        }
                    }

                    if (items.length > 0) {
                        insertMany(items);
                    }
                }
            }
        },
        saveCreds
    };
}

module.exports = { useSQLiteAuthState };
