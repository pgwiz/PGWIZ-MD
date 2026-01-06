/*****************************************************************************
 *                                                                           *
 *                     Developed By Qasim Ali                                *
 *                                                                           *
 *  🌐  GitHub   : https://github.com/pgwiz                         *
 *  ▶️  YouTube  : https://youtube.com/@pgwiz                       *
 *  💬  WhatsApp : https://whatsapp.com/channel/0029Va8cpObHwXbDoZE9VY3K     *
 *                                                                           *
 *    © 2026 pgwiz. All rights reserved.                            *
 *                                                                           *
 *    Description: This file is part of the PGWIZ-MD Project.                 *
 *                 Unauthorized copying or distribution is prohibited.       *
 *                                                                           *
 *****************************************************************************/


module.exports = {
  command: 'spoof',
  aliases: ['fakestatus', 'mockstatus'],
  category: 'tools',
  description: 'Send a message replying to a fake status',
  usage: '.spoof @user | StatusText | YourReply',

  async handler(sock, message, args, context = {}) {
    const chatId = context.chatId || message.key.remoteJid;
    const input = args.join(' ');
    
    if (!input.includes('|')) {
      return await sock.sendMessage(chatId, { 
        text: '*Usage:* .spoof @user | Status Content | Your Message' 
      }, { quoted: message });
    }

    const parts = input.split('|').map(t => t.trim());
    if (parts.length < 3) return await sock.sendMessage(chatId, { text: 'Missing parts. Use: User | Status | Reply' });

    const [user, statusText, replyText] = parts;
    const jid = user.replace('@', '') + '@s.whatsapp.net';

    try {
      await sock.sendMessage(chatId, { 
        text: replyText,
        contextInfo: {
          externalAdReply: {
            title: 'Status', 
            body: statusText,
            mediaType: 1,
            previewType: 0,
            showAdAttribution: false,
            thumbnail: Buffer.alloc(0), 
            sourceUrl: 'https://whatsapp.com' 
          },
          participant: jid,
          quotedMessage: {
            conversation: statusText
          }
        }
      });
    } catch (err) {
      console.error('Spoof Error:', err);
      await sock.sendMessage(chatId, { text: '❌ Failed to spoof. Protocol rejected.' });
    }
  }
};

/*****************************************************************************
 *                                                                           *
 *                     Developed By Qasim Ali                                *
 *                                                                           *
 *  🌐  GitHub   : https://github.com/pgwiz                         *
 *  ▶️  YouTube  : https://youtube.com/@pgwiz                       *
 *  💬  WhatsApp : https://whatsapp.com/channel/0029Va8cpObHwXbDoZE9VY3K     *
 *                                                                           *
 *    © 2026 pgwiz. All rights reserved.                            *
 *                                                                           *
 *    Description: This file is part of the PGWIZ-MD Project.                 *
 *                 Unauthorized copying or distribution is prohibited.       *
 *                                                                           *
 *****************************************************************************/
