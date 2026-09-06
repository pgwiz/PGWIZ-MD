const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// In-flight and completed deduplication cache to prevent duplicate sending
const processedStatusDownloads = new Set();
setInterval(() => {
  if (processedStatusDownloads.size > 2000) processedStatusDownloads.clear();
}, 60000);

module.exports = {
  command: 'dlstatus',
  aliases: ['swdl', 'statusdl', 'dlsw', 'statussave'],
  category: 'download',
  description: 'Download quoted Status updates',
  usage: 'Reply to a status and type .dlstatus',
  ownerOnly: true,

  async handler(sock, message, args, context = {}) {
    const chatId = context.chatId || message.key.remoteJid;
    const msgId = message.key?.id || '';

    // Unwrap message layers (ephemeral, viewOnce, deviceSent)
    let m = message.message;
    if (m?.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m?.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m?.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
    if (m?.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;

    const type = m ? Object.keys(m)[0] : '';
    const contextInfo = m?.[type]?.contextInfo || m?.extendedTextMessage?.contextInfo || message.message?.extendedTextMessage?.contextInfo;

    if (!contextInfo || contextInfo.remoteJid !== 'status@broadcast') {
      return await sock.sendMessage(chatId, { 
        text: "Please reply/quote a Status update to download it." 
      }, { quoted: message });
    }

    const quotedMsg = contextInfo.quotedMessage;
    if (!quotedMsg) return;

    // Strict deduplication lock: combination of command message ID and target status stanza ID
    const stanzaId = contextInfo.stanzaId || contextInfo.participant || '';
    const dedupeKey = `${chatId}_${msgId}_${stanzaId}`;
    if (processedStatusDownloads.has(dedupeKey)) {
      return; // Already processed this status download request
    }
    processedStatusDownloads.add(dedupeKey);
    setTimeout(() => processedStatusDownloads.delete(dedupeKey), 20000);

    try {
      let unwrapQuoted = quotedMsg;
      if (unwrapQuoted?.ephemeralMessage?.message) unwrapQuoted = unwrapQuoted.ephemeralMessage.message;
      if (unwrapQuoted?.viewOnceMessage?.message) unwrapQuoted = unwrapQuoted.viewOnceMessage.message;
      if (unwrapQuoted?.viewOnceMessageV2?.message) unwrapQuoted = unwrapQuoted.viewOnceMessageV2.message;

      const quotedType = Object.keys(unwrapQuoted)[0];
      const mediaData = unwrapQuoted[quotedType];

      if (quotedType === 'conversation' || quotedType === 'extendedTextMessage') {
        const text = unwrapQuoted.conversation || unwrapQuoted.extendedTextMessage?.text || '';
        return await sock.sendMessage(chatId, { text: `📝 *Status Text:*\n\n${text}` }, { quoted: message });
      }

      if (!mediaData) {
        return await sock.sendMessage(chatId, { text: "❌ Status media data not found." }, { quoted: message });
      }

      const stream = await downloadContentFromMessage(
        mediaData, 
        quotedType.replace('Message', '')
      );

      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }

      const caption = mediaData.caption || '';
      if (quotedType === 'imageMessage') {
        await sock.sendMessage(chatId, { image: buffer, caption }, { quoted: message });
      } else if (quotedType === 'videoMessage') {
        await sock.sendMessage(chatId, { video: buffer, caption }, { quoted: message });
      } else if (quotedType === 'audioMessage') {
        await sock.sendMessage(chatId, { 
          audio: buffer, 
          mimetype: mediaData.mimetype || 'audio/mp4', 
          ptt: Boolean(mediaData.ptt) 
        }, { quoted: message });
      }

    } catch (e) {
      console.error('SW Download Error:', e);
      await sock.sendMessage(chatId, { text: "❌ Failed to download status media." }, { quoted: message });
    }
  }
};
