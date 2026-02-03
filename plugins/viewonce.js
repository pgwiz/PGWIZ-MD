const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

module.exports = {
  command: 'viewonce',
  aliases: ['viewmedia', 'vv'],
  category: 'general',
  description: 'Re-send a view-once image, video, or voice note.',
  usage: '.viewonce (reply to a view-once media)',

  async handler(sock, message, args, context = {}) {
    const chatId = context.chatId || message.key.remoteJid;

    try {
      const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;

      // Check for different types of view-once messages (including V2)
      const quotedImage = quoted?.imageMessage;
      const quotedVideo = quoted?.videoMessage;
      const quotedAudio = quoted?.audioMessage;

      const viewOnceMessage = quoted?.viewOnceMessage || quoted?.viewOnceMessageV2;
      const viewOnceImage = viewOnceMessage?.message?.imageMessage;
      const viewOnceVideo = viewOnceMessage?.message?.videoMessage;
      const viewOnceAudio = viewOnceMessage?.message?.audioMessage;

      let mediaType = '';
      let mediaMessage = null;
      let caption = '';

      if (quotedImage && quotedImage.viewOnce) {
        mediaType = 'image';
        mediaMessage = quotedImage;
        caption = quotedImage.caption || '';
      } else if (quotedVideo && quotedVideo.viewOnce) {
        mediaType = 'video';
        mediaMessage = quotedVideo;
        caption = quotedVideo.caption || '';
      } else if (quotedAudio && quotedAudio.viewOnce) {
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

      const stream = await downloadContentFromMessage(mediaMessage, mediaType);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

      if (mediaType === 'image') {
        await sock.sendMessage(chatId, {
          image: buffer,
          caption: caption
        }, { quoted: message });
      } else if (mediaType === 'video') {
        await sock.sendMessage(chatId, {
          video: buffer,
          caption: caption
        }, { quoted: message });
      } else if (mediaType === 'audio') {
        await sock.sendMessage(chatId, {
          audio: buffer,
          mimetype: 'audio/mpeg',
          ptt: true
        }, { quoted: message });
      }

    } catch (error) {
      console.error('Error in viewonceCommand:', error);
      await sock.sendMessage(chatId, {
        text: '❌ Failed to retrieve the view-once media. Please try again later.'
      }, { quoted: message });
    }
  }
};
