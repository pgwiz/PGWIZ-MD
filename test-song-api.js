const axios = require('axios');
const fs = require('fs');

const API_BASE = 'https://api3.wpg.qzz.io';
const TEST_QUERY = 'Alan Walker Fade';

async function testDownload() {
    try {
        console.log('1. Searching for:', TEST_QUERY);
        const searchRes = await axios.get(`${API_BASE}/api/search/youtube`, {
            params: { query: TEST_QUERY }
        });

        // FIX: API returns { results: [...] }
        const searchData = searchRes.data?.results;

        if (!searchData || searchData.length === 0) {
            console.log('API Response:', JSON.stringify(searchRes.data, null, 2));
            throw new Error('No search results found');
        }

        const video = searchData[0];
        const videoUrl = `https://youtube.com/watch?v=${video.id || video.videoId}`;
        console.log(`   Found: ${video.title || video.videoTitle} (${videoUrl})`);

        console.log('2. Getting Stream URL...');
        console.log('   /get Params:', { ytl: videoUrl });
        const getRes = await axios.get(`${API_BASE}/get`, {
            params: { ytl: videoUrl }
        });

        console.log('   /get Response:', JSON.stringify(getRes.data, null, 2));

        let streamUrl = getRes.data?.url;

        // FIX: API returns tracks array even for single video
        if (!streamUrl && getRes.data?.tracks?.length > 0) {
            streamUrl = getRes.data.tracks[0].url;
        }

        if (!streamUrl) throw new Error('No stream URL returned');
        console.log('   Stream URL:', streamUrl);

        console.log('3. Downloading Audio Stream...');
        const writer = fs.createWriteStream('test_song.mp3');

        const response = await axios({
            url: streamUrl,
            method: 'GET',
            responseType: 'stream'
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                const stats = fs.statSync('test_song.mp3');
                console.log(`✅ Success! Downloaded test_song.mp3 (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
                resolve();
            });
            writer.on('error', reject);
        });

    } catch (err) {
        console.error('❌ Test Failed:', err.message);
        if (err.response) console.error('   API Status:', err.response.status, err.response.data);
    }
}

testDownload();
