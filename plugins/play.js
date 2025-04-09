const { gmd, MessageMedia  } = require('../lib');
const yts = require('yt-search');
const axios = require('axios');

gmd({
    pattern: "play",
    fromMe: true,
    alias: ["song", "music"],
    desc: "Search and stream music from YouTube",
    category: "music",
    react: "🎵",
    filename: __filename
},
async (Gifted, msg, { reply, from, args, q, react }) => {
    try {
        if (!q && (!args || args.length === 0)) {
            return await reply("Please specify a song name!\nExample: .play Spectre");
        }

        const searchQuery = q || args.join(' ');
        const chatId = msg.from;

        const search = await yts(searchQuery);
        if (!search.videos || search.videos.length === 0) {
            return await reply("No results found for your search 😢");
        }

        const video = search.videos[0];
        await reply(`🔍 Found: *${video.title}* (${video.timestamp})`);

        const apiResponse = await axios.get(
            `https://api.giftedtech.web.id/api/download/dlmp3`,
            {
                params: {
                    apikey: "gifted",
                    url: video.url
                },
                timeout: 60000 
            }
        );

        if (!apiResponse.data?.result?.download_url) {
            throw new Error("No download URL received from API");
        }

        const media = await MessageMedia.fromUrl(apiResponse.data.result.download_url, {
            unsafeMime: true,
            filename: `${video.title.substring(0, 100)}.mp3`
        });
        await Gifted.sendMessage(chatId, media, {
            sendAudioAsVoice: false,
            quoted: msg
        });
        await react("🎧");

    } catch (error) {
        console.error("Play Error:", error.message);
        if (!error.audioSent) {
            await reply("❌ Error: Couldn't process the song. Try another one!");
        }
        await react("❌");
    }
});
