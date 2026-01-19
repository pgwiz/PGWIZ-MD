# Environment Variables Configuration Guide

This document explains all available environment variables for PGWIZ-MD bot configuration.

## 🔐 Authentication & Session

### `SESSION_ID`
- **Description**: Your bot session ID from the pairing service
- **Required**: Yes (for first-time setup)
- **Example**: `SESSION_ID="PGWIZ_MD_abc123xyz"`

### `PAIRING_NUMBER`
- **Description**: Phone number for pairing code generation (without + or spaces)
- **Format**: Country code + number (e.g., `254789462334`)
- **Example**: `PAIRING_NUMBER="254789462334"`

---

## 🗄️ Database Configuration

### `DB_URL`
- **Description**: SQLite database file path
- **Default**: `./baileys_store.db`
- **Example**: `DB_URL="./baileys_store.db"`

### `MONGO_URL`
- **Description**: MongoDB connection string (for unlimited storage)
- **Optional**: Yes
- **Example**: `MONGO_URL="mongodb+srv://user:pass@cluster.mongodb.net/dbname"`

### `POSTGRES_URL`
- **Description**: PostgreSQL connection string (for unlimited storage)
- **Optional**: Yes
- **Example**: `POSTGRES_URL="postgresql://user:pass@host:5432/dbname"`

### `MYSQL_URL`
- **Description**: MySQL connection string (for unlimited storage)
- **Optional**: Yes
- **Example**: `MYSQL_URL="mysql://user:pass@host:3306/dbname"`

---

## 🌐 Server Configuration

### `PORT`
- **Description**: HTTP server port
- **Default**: `5000`
- **Example**: `PORT="5000"`

---

## 📱 Auto Status Configuration

### `AUTO_STATUS_VIEW`
- **Description**: Automatically view all WhatsApp statuses
- **Values**: `"true"` or `"false"`
- **Default**: `"false"`
- **Example**: `AUTO_STATUS_VIEW="true"`

### `AUTO_STATUS_REACT`
- **Description**: Automatically react to all WhatsApp statuses
- **Values**: `"true"` or `"false"`
- **Default**: `"false"`
- **Example**: `AUTO_STATUS_REACT="true"`

### `STATUS_EMOJIS`
- **Description**: Comma-separated list of emojis for status reactions
- **Default**: `"💚,❤️,🔥,😍,👏"`
- **Example**: `STATUS_EMOJIS="💚,❤️,🔥,😍,👏,🎉,✨"`

---

## 👑 Sudo Users Configuration

### `SUDO_USERS`
- **Description**: Comma-separated list of phone numbers with elevated privileges
- **Format**: Country code + number (without + or spaces)
- **Optional**: Yes
- **Example**: `SUDO_USERS="254789462334,1234567890,9876543210"`

**What Sudo Users Can Do:**
- Use owner-only commands (except strict owner commands like `.sudo`)
- Bypass private mode restrictions
- Manage groups, settings, and features
- Almost like being the owner

---

## 🔑 API Keys

### `REMOVEBG_KEY`
- **Description**: Remove.bg API key for background removal
- **Optional**: Yes
- **Example**: `REMOVEBG_KEY="your_api_key_here"`

---

## 📝 Example `.env` File

```env
# Authentication
SESSION_ID="PGWIZ_MD_abc123xyz"
PAIRING_NUMBER="254789462334"

# Database
DB_URL="./baileys_store.db"
# MONGO_URL="mongodb+srv://user:pass@cluster.mongodb.net/dbname"

# Server
PORT="5000"

# Auto Status
AUTO_STATUS_VIEW="true"
AUTO_STATUS_REACT="true"
STATUS_EMOJIS="💚,❤️,🔥,😍,👏"

# Sudo Users
SUDO_USERS="254789462334,1234567890"

# API Keys
REMOVEBG_KEY="your_api_key_here"
```

---

## 🚀 How It Works

### First-Time Initialization

When you start the bot for the **first time** (no existing database or config files):

1. **Auto Status**: If `AUTO_STATUS_VIEW` or `AUTO_STATUS_REACT` is set to `"true"`, the bot will automatically enable these features
2. **Sudo Users**: If `SUDO_USERS` contains phone numbers, they will be automatically added as sudo users

### Subsequent Runs

After the first initialization:
- Settings are stored in the database/files
- Environment variables are **only checked on first run**
- Use bot commands (`.autostatus`, `.sudo`) to modify settings later

---

## 💡 Tips

1. **Always use quotes** around values in `.env` file
2. **No spaces** in phone numbers (use `254789462334`, not `254 789 462 334`)
3. **Comma-separated** for multiple values (no spaces after commas)
4. **Restart the bot** after changing `.env` file
5. **Delete database/config files** to re-initialize from `.env` (⚠️ This will reset all settings!)

---

## 🔄 Re-initializing from Environment Variables

If you want to reset and re-initialize from `.env`:

**With Database:**
```bash
# Delete the database
rm baileys_store.db
# Restart bot
```

**With File System:**
```bash
# Delete config files
rm data/autoStatus.json
rm data/userGroupData.json
# Restart bot
```

---

## 📞 Support

For more help, join our WhatsApp channel:
https://whatsapp.com/channel/0029Va8cpObHwXbDoZE9VY3K
