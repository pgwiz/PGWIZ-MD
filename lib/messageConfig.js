const settings = require('../settings');
const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: settings.newsletterJid || '120363319098372999@newsletter',
            newsletterName: settings.newsletterName || 'PGWIZ-MD',
            serverMessageId: -1
        }
    }
};

module.exports = {
    channelInfo: channelInfo
};
