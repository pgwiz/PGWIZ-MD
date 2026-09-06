# Project Memory & Technical Backlog

## 📌 Downloader Modernization & API Replacement Backlog

The following downloaders were audited and flagged as currently non-functional due to external third-party API outages, dead domains, or HTTP 503/402 errors. They are queued for replacement with high-speed, reliable alternative endpoints:

---

### 🔴 High-Priority Downloaders to Fix:

1. **Instagram Downloader (`.instagram` / `.ig`)**
   - **Target File**: `plugins/instagram.js`
   - **Issue**: `api.giftedtech.web.id` is unreachable (`ENOTFOUND` domain dead).
   - **Planned Fix**: Integrate Instagram Scraper/API (e.g. SnapInsta API, FastDL API, or direct GraphQL metadata scraper).

2. **Twitter / X Video Downloader (`.twitter` / `.x` / `.xdl`)**
   - **Target File**: `plugins/twitter.js`
   - **Issue**: Hardcoded to `discardapi.dpdns.org` (`HTTP 503 Service Unavailable`).
   - **Planned Fix**: Integrate Twitsave / Twitter APIv2 / direct CDN syndication parser.

3. **Spotify Music Downloader (`.spotify`)**
   - **Target File**: `plugins/spotify.js`
   - **Issue**: `okatsu-rolezapiiz.vercel.app` returns `HTTP 402 Payment Required` (quota exhausted).
   - **Planned Fix**: Bridge Spotify search metadata to `https://ytsp-api.pgwiz.cloud` audio streamer or direct Spotify-dl stream.

4. **SoundCloud Downloader (`.scloud` / `.soundcloud`)**
   - **Target File**: `plugins/scloud.js`
   - **Issue**: `discardapi.dpdns.org` returns `HTTP 503`.
   - **Planned Fix**: Integrate direct SoundCloud v2 API / client_id resolver or alternative streaming endpoints.

5. **Lyrics Finder (`.lyrics`)**
   - **Target File**: `plugins/lyrics.js`
   - **Issue**: `discardapi.dpdns.org` returns `HTTP 503`.
   - **Planned Fix**: Integrate Genius / Musixmatch / AZLyrics direct parser or Lyrics.ovh API.

6. **APK Downloaders (`.apkmirror` / `.apkpure`)**
   - **Target File**: `plugins/apkmirror.js`, `plugins/apkpure.js`
   - **Issue**: `discardapi.dpdns.org` returns `HTTP 503`.
   - **Planned Fix**: Direct APKPure / APKMirror / Aptoide web scraper or Google Play scraper.

7. **Google Image Search (`.gimage` / `.image`)**
   - **Target File**: `plugins/gimage.js`
   - **Issue**: `discardapi.dpdns.org` returns `HTTP 503`.
   - **Planned Fix**: Integrate Google Custom Search API, Unsplash API, or DuckDuckGo Image scraper.

8. **Snapchat Video Downloader (`.snapchat`)**
   - **Target File**: `plugins/snapchat.js`
   - **Issue**: `discardapi.dpdns.org` returns `HTTP 503`.
   - **Planned Fix**: Integrate SnapStory / Spotlight video resolver.

9. **Stock Media & Video Downloaders (`.alamy`, `.getty`, `.istock`, `.vidsplay`, `.sharechat`, `.snack`)**
   - **Target Files**: `plugins/alamy.js`, `plugins/getty.js`, `plugins/istock.js`, `plugins/vidsplay.js`, `plugins/sharechat.js`, `plugins/snackvideo.js`
   - **Issue**: Hardcoded to dead `discardapi.dpdns.org` (`HTTP 503`).
   - **Planned Fix**: Replace with working stock scrapers or consolidate into a single universal media command.

---

### 🟢 Fully Functional & Verified Downloaders:
* **`.song` / `.mp3`**: Powered by `https://ytsp-api.pgwiz.cloud` (Dual playable audio + MP3 document).
* **`.play` / `.music`**: Instant YouTube audio player via `https://ytsp-api.pgwiz.cloud`.
* **`.video` / `.ytmp4`**: High-speed YouTube video downloader (360p & 720p HD).
* **`.tiktok` / `.tt`**: Multi-Engine HD TikTok downloader (`TikWM` + `SaveTik.co` + `MusicalDown` scrapers with canonical unshortener, No Watermark, Photo Slideshows, and MP3 audio extraction).
* **`.mediafire`**: Direct Cheerio HTML stream parser.
* **`.gitclone` / `.gitclone2`**: Official GitHub Repository zipball downloader.
* **`.facebook` / `.fb`**: `gtech-api-xtp1.onrender.com` video extractor.
* **`.statusdl`**: Native Baileys WhatsApp status decryptor.

---

### ⚡ Smart Auto-Reaction Engine:
* Integrated into `lib/reactions.js`, `lib/messageHandler.js`, and `plugins/areact.js`.
* Automatically classifies incoming message sentiments (Laughter, Love, Greetings, Thanks, Fire/Celebration, Questions, Sympathy, Agreement, Surprise, Music, Faith) to react with the most suitable emojis.
* Controlled via `.autoreact on/off/dm/group/status` and persistent across reboot via `store.getSetting('global', 'autoReact')` and `.pgvars AUTO_REACT`.

---

### 👁️ WhatsApp Multi-Device Auto Status View & Reaction Architecture:
* **Status Views**: WhatsApp Multi-Device has no separate "view" API. Sending an explicit `type: 'read'` receipt (`sock.sendReceipt('status@broadcast', normParticipant, [key.id], 'read')` alongside `sock.readMessages([msg.key])`) is what adds the bot to the author's viewer list.
* **Never Send `read-self`**: `read-self` tells WhatsApp servers to keep the read private to the user's companion devices and explicitly suppresses notifying the status author.
* **Status Reaction**: Multi-Device status reactions require `sock.sendMessage('status@broadcast', { react: { text: emoji, key: reactionKey } }, { statusJidList })` alongside `sock.relayMessage(...)`.
* **LID (Linked Identity) & Phone Number Support**: `reactionKey.participant` must preserve the raw author JID (especially `@lid` accounts), and `statusJidList` must include both raw and normalized participant JIDs (excluding `'status@broadcast'`).
* **Privacy Prerequisite**: The status author MUST have the bot's phone number saved in their contacts, otherwise WhatsApp servers never fan out the status stanza to the bot.
