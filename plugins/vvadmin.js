const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const settings = require('../settings');

module.exports = {
    command: 'vvadmin',
    aliases: ['vvowner'],
    category: 'admin',
    description: 'Forward a view-once media (image/video/audio) to the main admin.',
    usage: '.vvadmin (reply to a view-once media)',

    async handler(sock, message, args, context = {}) {
        const chatId = context.chatId || message.key.remoteJid;

        try {
            const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;

            // Check for different types of view-once messages
            const quotedImage = quoted?.imageMessage;
            const quotedVideo = quoted?.videoMessage;
            const quotedAudio = quoted?.audioMessage;

            // Also check if the quoted message is a viewOnceMessageV2 (common in recent updates)
            const viewOnceMessage = quoted?.viewOnceMessage || quoted?.viewOnceMessageV2;
            const viewOnceImage = viewOnceMessage?.message?.imageMessage;
            const viewOnceVideo = viewOnceMessage?.message?.videoMessage;
            const viewOnceAudio = viewOnceMessage?.message?.audioMessage;

            // Determine the media type and content
            let mediaType = '';
            let mediaMessage = null;
            let caption = '';

            if (quotedImage && (quotedImage.viewOnce || quotedImage.fileLength)) {
                mediaType = 'image';
                mediaMessage = quotedImage;
                caption = quotedImage.caption || '';
            } else if (quotedVideo && (quotedVideo.viewOnce || quotedVideo.fileLength)) {
                mediaType = 'video';
                mediaMessage = quotedVideo;
                caption = quotedVideo.caption || '';
            } else if (quotedAudio && (quotedAudio.viewOnce || quotedAudio.fileLength)) {
                mediaType = 'audio';
                mediaMessage = quotedAudio;
            } else if (viewOnceImage) {
                mediaType = 'image';
                mediaMessage = viewOnceImage;
                caption = viewOnceImage.caption || '';
            } else if (viewOnceVideo) {
                mediaType = 'video';
                mediaMessage = viewOnceVideo;
                caption = viewOnceVideo.caption || '';
            } else if (viewOnceAudio) {
                mediaType = 'audio';
                mediaMessage = viewOnceAudio;
            }

            if (!mediaType || !mediaMessage) {
                await sock.sendMessage(chatId, {
                    text: '❌ Please reply to a valid view-once image, video, or voice note.'
                }, { quoted: message });
                return;
            }

            // Get Main Admin (Owner) JID
            const ownerNumber = settings.ownerNumber && settings.ownerNumber[0]
                ? settings.ownerNumber[0] + '@s.whatsapp.net'
                : null;

            if (!ownerNumber) {
                await sock.sendMessage(chatId, {
                    text: '❌ Main admin number is not configured in settings.'
                }, { quoted: message });
                return;
            }

            // Download content
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            // Prepare message content based on type
            let messageContent = {};
            if (mediaType === 'image') {
                messageContent = { image: buffer, caption: `Forwarded ViewOnce Image\n\n${caption}` };
            } else if (mediaType === 'video') {
                messageContent = { video: buffer, caption: `Forwarded ViewOnce Video\n\n${caption}` };
            } else if (mediaType === 'audio') {
                messageContent = { audio: buffer, mimetype: 'audio/mpeg', ptt: true }; // Send as voice note
            }

            // Send to Owner
            await sock.sendMessage(ownerNumber, messageContent);

            // React to confirm success
            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

        } catch (error) {
            console.error('Error in vvadminCommand:', error);
            await sock.sendMessage(chatId, {
                text: '❌ Failed to forward the media. Ensure it is a valid view-once message.'
            }, { quoted: message });
        }
    }
};
