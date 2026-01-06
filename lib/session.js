const path = require('path');
const fs = require('fs');
const axios = require('axios');

// PGWIZ Session Service
const SESSION_BASE_URL = 'https://session-s.pgwiz.cloud';

/**
 * Save credentials from PGWIZ Session Service to session/creds.json
 * @param {string} sessionId - Session ID from environment variable
 */
async function SaveCreds(sessionId) {
    const __dirname = path.dirname(__filename);

    if (!sessionId) {
        console.error('❌ No SESSION_ID provided');
        throw new Error('SESSION_ID is required');
    }

    const credsUrl = `${SESSION_BASE_URL}/download?id=${sessionId}`;

    try {
        console.log('📥 Downloading session from PGWIZ Session Service...');
        const response = await axios.get(credsUrl);
        const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

        const sessionDir = path.join(__dirname, '..', 'session');
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        const credsPath = path.join(sessionDir, 'creds.json');
        fs.writeFileSync(credsPath, data);
        console.log('✅ Session credentials saved successfully');

    } catch (error) {
        console.error('❌ Error downloading or saving credentials:', error.message);
        if (error.response) {
            console.error('❌ Status:', error.response.status);
            console.error('❌ Response:', error.response.data);
        }
        throw error;
    }
}

module.exports = SaveCreds;

