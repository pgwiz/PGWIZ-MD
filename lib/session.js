const path = require('path');
const fs = require('fs');
const axios = require('axios');

// PGWIZ Session Service
const SESSION_BASE_URL = process.env.SESSION_BASE_URL || 'https://session-s.pgwiz.cloud';

/**
 * Save credentials from PGWIZ Session Service or inline string to session/creds.json
 * @param {string} sessionId - Session ID from environment variable
 */
async function SaveCreds(sessionId) {
    const __dirname = path.dirname(__filename);

    if (!sessionId || typeof sessionId !== 'string') {
        console.error('❌ No SESSION_ID provided');
        throw new Error('SESSION_ID is required');
    }

    // Clean and sanitize input
    let cleanId = sessionId.trim().replace(/^["']|["']$/g, '').trim();
    if (cleanId.startsWith('SESSION_ID=')) {
        cleanId = cleanId.replace('SESSION_ID=', '').trim().replace(/^["']|["']$/g, '').trim();
    }

    const sessionDir = path.join(__dirname, '..', 'session');
    const shouldForceReset = String(process.env.FORCE_SESSION_RESET || '').toLowerCase() === 'true';

    if (shouldForceReset && fs.existsSync(sessionDir)) {
        console.log('🧹 FORCE_SESSION_RESET=true -> clearing old session files...');
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }

    fs.mkdirSync(sessionDir, { recursive: true });

    // 1. Check if SESSION_ID is direct JSON (e.g. {"noiseKey":...})
    if (cleanId.startsWith('{') && cleanId.endsWith('}')) {
        try {
            const parsed = JSON.parse(cleanId);
            if (parsed.me && parsed.me.id) parsed.registered = true;
            const credsPath = path.join(sessionDir, 'creds.json');
            fs.writeFileSync(credsPath, JSON.stringify(parsed, null, 2));
            console.log('✅ Direct JSON session credentials saved successfully');
            return;
        } catch (jsonErr) {
            console.warn('⚠️ SESSION_ID looked like JSON but parse failed:', jsonErr.message);
        }
    }

    // 2. Check if SESSION_ID is raw Base64 JSON
    if (cleanId.length > 100 && /^[A-Za-z0-9+/=]+$/.test(cleanId) && !cleanId.startsWith('pgwiz_') && !cleanId.startsWith('PGWIZ')) {
        try {
            const decodedStr = Buffer.from(cleanId, 'base64').toString('utf8');
            if (decodedStr.startsWith('{') && decodedStr.endsWith('}')) {
                const parsed = JSON.parse(decodedStr);
                if (parsed.me && parsed.me.id) parsed.registered = true;
                const credsPath = path.join(sessionDir, 'creds.json');
                fs.writeFileSync(credsPath, JSON.stringify(parsed, null, 2));
                console.log('✅ Base64 session credentials decoded and saved successfully');
                return;
            }
        } catch {}
    }

    // 3. Remote Download with retries, timeout, and browser headers (bypasses Cloudflare WAF on Koyeb/Render/Heroku)
    const credsUrl = `${SESSION_BASE_URL}/download?id=${encodeURIComponent(cleanId)}`;
    console.log('🔑 SESSION_ID:', cleanId);
    console.log('🌐 Fetching from:', credsUrl);

    let lastError = null;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`📥 Downloading session from PGWIZ Session Service (attempt ${attempt}/${maxRetries})...`);
            const response = await axios.get(credsUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Connection': 'keep-alive'
                },
                timeout: 15000
            });

            const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            let finalData = data;

            try {
                const parsed = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                if (parsed.me && parsed.me.id && parsed.registered !== true) {
                    parsed.registered = true;
                    finalData = JSON.stringify(parsed, null, 2);
                    console.log('✅ Enforced registered=true for downloaded session identity:', parsed.me.id);
                }
                console.log('📋 Downloaded creds summary:');
                console.log('   - registered:', parsed.registered);
                console.log('   - has noiseKey:', !!parsed.noiseKey);
                console.log('   - has signedIdentityKey:', !!parsed.signedIdentityKey);
                console.log('   - has signedPreKey:', !!parsed.signedPreKey);
                console.log('   - has me:', !!parsed.me);
                if (parsed.me) {
                    console.log('   - me.id:', parsed.me.id);
                }
            } catch (parseErr) {
                console.log('⚠️ Could not parse downloaded creds for debug:', parseErr.message);
            }

            const credsPath = path.join(sessionDir, 'creds.json');
            fs.writeFileSync(credsPath, finalData);
            console.log('✅ Session credentials saved successfully');
            return;

        } catch (error) {
            lastError = error;
            console.error(`❌ Error downloading credentials (attempt ${attempt}/${maxRetries}):`, error.message);
            if (error.response) {
                console.error('❌ Status:', error.response.status);
            }
            if (attempt < maxRetries) {
                const delayMs = attempt * 2000;
                console.log(`⏳ Waiting ${delayMs / 1000}s before retry...`);
                await new Promise(res => setTimeout(res, delayMs));
            }
        }
    }

    throw lastError || new Error('Failed to download session credentials after multiple attempts');
}

module.exports = SaveCreds;
