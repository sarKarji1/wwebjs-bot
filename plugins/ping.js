const { gmd } = require('../handler');

gmd({
    pattern: "ping",
    alias: ["speed"],
    desc: "Check Bot's Response Speed.",
    category: "general",
    react: "⚡",
    filename: __filename
},
async (Gifted, mek, { reply, react }) => {
    try {
        const start = Date.now();
        await reply('Pinging...');
        const ping = Date.now() - start;
        await reply(`Pong: ${ping}ms`); 
        await react("✅");
    } catch (e) {
        console.error("Ping Error:", e);
    }
});
