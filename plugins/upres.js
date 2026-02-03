const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const commandHandler = require('../lib/commandHandler');

// Reuse update logic if possible, or implement a lighter version
async function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
            if (err) return reject(new Error((stderr || stdout || err.message || '').toString()));
            resolve((stdout || '').toString());
        });
    });
}

async function updateViaGit() {
    await run('git remote set-url origin https://github.com/WiPTechGx/MEGA-MD.git').catch(() => { });
    const oldRev = (await run('git rev-parse HEAD').catch(() => 'unknown')).trim();
    await run('git fetch --all --prune');
    const newRev = (await run('git rev-parse origin/main')).trim();

    if (oldRev === newRev) {
        return { updated: false, message: 'Already up to date' };
    }

    await run(`git reset --hard ${newRev}`);
    await run('git clean -fd -e session -e .env -e store.json -e session/');
    return { updated: true, oldRev, newRev };
}

module.exports = {
    command: 'upres',
    aliases: ['hotupdate'],
    category: 'owner',
    description: 'Update the bot and hot-reload commands without killing the process.',
    usage: '.upres',
    ownerOnly: true,

    async handler(sock, message, args, context) {
        const { chatId } = context;

        try {
            await sock.sendMessage(chatId, { text: '🔄 Checking for updates...' }, { quoted: message });

            // 1. Perform Update
            let updateResult;
            try {
                if (fs.existsSync(path.join(process.cwd(), '.git'))) {
                    updateResult = await updateViaGit();
                } else {
                    // For now, only Git update is supported for hot reload safety
                    await sock.sendMessage(chatId, { text: '❌ .upres only works with Git-based installations for now.' }, { quoted: message });
                    return;
                }
            } catch (err) {
                await sock.sendMessage(chatId, { text: `❌ Update failed: ${err.message}` }, { quoted: message });
                return;
            }

            // 2. Hot Reload Commands
            if (updateResult.updated) {
                await sock.sendMessage(chatId, { text: `✅ Updated from ${updateResult.oldRev.substring(0, 7)} to ${updateResult.newRev.substring(0, 7)}.\n\n🔄 Hot-reloading commands...` }, { quoted: message });
            } else {
                await sock.sendMessage(chatId, { text: `✅ Already up to date.\n\n🔄 Force reloading commands anyway...` }, { quoted: message });
            }

            try {
                // Reload all plugins
                commandHandler.reloadCommands();
                await sock.sendMessage(chatId, { text: '✅ Hot-reload complete! New commands are ready.' }, { quoted: message });
            } catch (reloadErr) {
                console.error('Hot reload failed:', reloadErr);
                await sock.sendMessage(chatId, { text: `⚠️ Update successful, but hot-reload failed: ${reloadErr.message}. You may need to restart manually.` }, { quoted: message });
            }

        } catch (error) {
            console.error('Error in upres:', error);
            await sock.sendMessage(chatId, { text: `❌ Error: ${error.message}` }, { quoted: message });
        }
    }
};
