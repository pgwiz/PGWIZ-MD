const axios = require('axios');
(async () => {
    try {
        const res = await axios.get('https://api3.wpg.qzz.io/api/search/youtube?query=fade');
        console.log('Is Array:', Array.isArray(res.data));
        if (!Array.isArray(res.data)) {
            console.log('KEYS:', Object.keys(res.data));
        }
    } catch (e) { console.error(e.message); }
})();
