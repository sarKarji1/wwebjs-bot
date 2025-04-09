const { gmd } = require('../handler');

gmd({
    pattern: "uptime",
    alias: ["runtime"],
    desc: "Check Bot's Server Runtime.",
    category: "general",
    react: "⚡",
    filename: __filename
},
async (Gifted, msg, { from, reply }) => {
    try {
        const chatId = msg.from;
        const uptime = process.uptime();
        const days = Math.floor(uptime / 86400);
        const hours = Math.floor((uptime % 86400) / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        
        await reply(
            `*Uptime:* ${days}d ${hours}h ${minutes}m ${seconds}s`
        );
    } catch (e) {
        console.error(e);
        reply(`Error: ${e.message}`);
    }
});
