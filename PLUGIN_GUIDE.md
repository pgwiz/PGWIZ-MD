# 🧩 MEGA-MD Plugin Development Guide

This detailed guide explains how to create, test, and manage plugins for **MEGA-MD**.

---

## 📂 1. Plugin Structure
All plugins are located in the `plugins/` directory. Each file is a standard **CommonJS module** (`.js`) that exports a configuration object.

### **Minimal Template**
```javascript
const settings = require('../settings'); // Optional: Import settings if needed

module.exports = {
    command: 'hello',             // Primary command name (e.g., .hello)
    aliases: ['hi', 'greet'],     // Alternative names
    category: 'general',          // Category for help menu
    description: 'Sends a greeting',
    usage: '.hello',

    async handler(sock, message, args, context) {
        const chatId = context.chatId;
        
        await sock.sendMessage(chatId, { 
            text: 'Hello World! 👋' 
        }, { quoted: message });
    }
};
```

---

## ⚙️ 2. Configuration Properties

| Property | Type | Description |
| :--- | :--- | :--- |
| **`command`** | `String` | **Required.** The main trigger (e.g., `'kick'` → `.kick`). |
| **`aliases`** | `Array` | List of alternate triggers (e.g., `['remove', 'ban']`). |
| **`category`** | `String` | Grouping for the help menu (e.g., `'group', 'owner', 'fun'`). |
| **`description`** | `String` | Brief explanation of what the command does. |
| **`usage`** | `String` | Example usage shown in help (e.g., `.kick @user`). |
| **`handler`** | `Function` | **Required.** The code that executes when the command is triggered. |

### **Permission Flags (Optional)**

| Flag | Type | Description |
| :--- | :--- | :--- |
| **`ownerOnly`** | `Boolean` | Only the owner or Sudo users can use this. |
| **`strictOwnerOnly`** | `Boolean` | **Only** the main owner (no Sudo) can use this. |
| **`adminOnly`** | `Boolean` | Only Group Admins can use this. |
| **`groupOnly`** | `Boolean` | Command only works inside groups. |
| **`isPrefixless`** | `Boolean` | If `true`, triggers without a prefix (e.g., just typing `bot` works). |
| **`cooldown`** | `Number` | Time in milliseconds to wait before reusing (default: 3000ms). |

---

## 🧑‍💻 3. The `handler` Function

The logic lives here: `async handler(sock, message, args, context)`

### **1. `sock` (The Socket Connection)**
The main Baileys instance used to send messages, download media, etc.
*   `sock.sendMessage(jid, content, options)`
*   `sock.groupParticipantsUpdate(jid, participants, action)`
*   `sock.downloadMediaMessage(message)`

### **2. `message` (The Raw Message)**
The full WAMessage object from Baileys.
*   `message.key.remoteJid`: The Chat ID.
*   `message.key.fromMe`: Boolean, true if sent by the bot.
*   `message.pushName`: Sender's display name.

### **3. `args` (Arguments)**
An array of words typed after the command.
*   User types: `.say Hello World`
*   `args`: `["Hello", "World"]`
*   `args.join(" ")`: `"Hello World"`

### **4. `context` (The Helper Object)**
Pre-calculated values to save you time. Use these!
```javascript
const { 
    chatId,              // The JID of the current chat
    senderId,            // The JID of the sender (user)
    isGroup,             // Boolean: Is this a group?
    isSenderAdmin,       // Boolean: Is the sender an admin?
    isBotAdmin,          // Boolean: Is the bot an admin?
    senderIsOwnerOrSudo, // Boolean: Is the sender authorized?
    channelInfo,         // Object: Standard contextInfo for channel forwarding
    messageText,         // String: Full text content of the message
    rawText              // String: Unprocessed text
} = context;
```

---

## 💡 4. Examples

### **A. Admin-Only Group Command**
```javascript
module.exports = {
    command: 'promote',
    category: 'group',
    groupOnly: true, // Only in groups
    adminOnly: true, // Only admins can use
    
    async handler(sock, message, args, context) {
        const { chatId, isBotAdmin } = context;

        // Check mentions/replies
        const target = message.message?.extendedTextMessage?.contextInfo?.participant 
                       || args[0]?.replace('@', '') + '@s.whatsapp.net';

        if (!isBotAdmin) return sock.sendMessage(chatId, { text: 'I need to be Admin first!' });
        if (!target) return sock.sendMessage(chatId, { text: 'Tag someone to promote!' });

        await sock.groupParticipantsUpdate(chatId, [target], 'promote');
        await sock.sendMessage(chatId, { text: '✅ User promoted!' });
    }
};
```

### **B. Media Downloader (Fetching Data)**
```javascript
const axios = require('axios');

module.exports = {
    command: 'joke',
    category: 'fun',
    
    async handler(sock, message, args, context) {
        try {
            const res = await axios.get('https://official-joke-api.appspot.com/random_joke');
            const joke = `${res.data.setup}\n\n😂 *${res.data.punchline}*`;
            
            await sock.sendMessage(context.chatId, { text: joke }, { quoted: message });
        } catch (err) {
            console.error(err);
            await sock.sendMessage(context.chatId, { text: 'Failed to fetch joke.' });
        }
    }
};
```

---

## 🛠️ 5. Best Practices
1.  **Always use `try/catch` blocks** for API calls or dangerous operations.
2.  **Use `channelInfo`** in `sendMessage` options to keep the bot's branding consistent.
3.  **Check `args`** if your command requires input (e.g., search queries).
4.  **Use `context`** instead of parsing `message` manually when possible.
5.  **Hot Reloading:** The bot automatically reloads plugins when you save the file! You don't need to restart.
