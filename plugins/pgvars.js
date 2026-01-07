const fs = require('fs');
const path = require('path');
const config = require('../config');

// Path to .env file
const envPath = path.join(__dirname, '../.env');

// Helper to read .env
function readEnv() {
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    const env = {};
    lines.forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            let value = parts.slice(1).join('=').trim();
            // Remove surrounding quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (key && !key.startsWith('#')) {
                env[key] = value;
            }
        }
    });
    return env;
}

// Helper to write to .env
function writeEnv(env) {
    let content = '';
    for (const [key, value] of Object.entries(env)) {
        // Enclose value in quotes if it contains spaces or symbols and isn't already quoted
        let data = value;
        if (!data.startsWith('"') && (data.includes(' ') || data.includes('=') || data.includes('#'))) {
            data = `"${data}"`;
        }
        content += `${key}=${data}\n`;
    }
    fs.writeFileSync(envPath, content.trim() + '\n');
}

module.exports = {
    command: 'pgvars',
    aliases: ['setenv', 'getenv', 'pgvar'],
    category: 'admin',
    description: 'Manage .env variables (Owner Only)',
    usage: '.pgvars <list/update/delete> [KEY=VALUE]',
    ownerOnly: true,

    async handler(sock, message, args, context = {}) {
        const { chatId } = context;
        const subCmd = args[0] ? args[0].toLowerCase() : 'help';

        try {
            if (subCmd === 'list') {
                const env = readEnv();
                let text = '📋 *Current Environment Variables*\n\n';
                if (Object.keys(env).length === 0) {
                    text += '_No variables set._';
                } else {
                    for (const [key, value] of Object.entries(env)) {
                        text += `🔹 *${key}*: \`${value}\`\n`;
                    }
                }
                text += '\n_Note: Sensitive values are shown plainly._';
                await sock.sendMessage(chatId, { text }, { quoted: message });
                return;
            }

            if (subCmd === 'update' || subCmd === 'add' || subCmd === 'set') {
                const input = args.slice(1).join(' ');
                if (!input.includes('=')) {
                    await sock.sendMessage(chatId, { text: '❌ Invalid format. Use: `.pgvars update KEY=VALUE`' }, { quoted: message });
                    return;
                }

                const key = input.split('=')[0].trim();
                let value = input.split('=').slice(1).join('=').trim();

                // Auto-quote handling logic handled in writeEnv, but let's handle explicit newlines or complex input here if needed?
                // Actually writeEnv handles basic quoting.

                const env = readEnv();
                env[key] = value;
                writeEnv(env);

                await sock.sendMessage(chatId, { text: `✅ Updated *${key}*.\n\n🔄 *Restart required* for changes to take effect.` }, { quoted: message });
                return;
            }

            if (subCmd === 'delete' || subCmd === 'remove' || subCmd === 'del') {
                const key = args[1];
                if (!key) {
                    await sock.sendMessage(chatId, { text: '❌ Please specify a key to delete.' }, { quoted: message });
                    return;
                }

                const env = readEnv();
                if (env[key]) {
                    delete env[key];
                    writeEnv(env);
                    await sock.sendMessage(chatId, { text: `✅ Deleted *${key}*.\n\n🔄 *Restart required* for changes to take effect.` }, { quoted: message });
                } else {
                    await sock.sendMessage(chatId, { text: `⚠️ Key *${key}* not found.` }, { quoted: message });
                }
                return;
            }

            // Help
            let helpText = '🛠️ *PGVars - Environment Manager*\n\n';
            helpText += 'Commands:\n';
            helpText += '🔹 *.pgvars list* - Show all variables\n';
            helpText += '🔹 *.pgvars update KEY=VALUE* - Set/Update variable\n';
            helpText += '🔹 *.pgvars delete KEY* - Remove variable\n';
            helpText += '\n_Example: .pgvars update SESSION_ID=xyz_';

            await sock.sendMessage(chatId, { text: helpText }, { quoted: message });

        } catch (error) {
            console.error('PGVars Error:', error);
            await sock.sendMessage(chatId, { text: `❌ Error: ${error.message}` }, { quoted: message });
        }
    }
};
