const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const { gmd, commands } = require('./lib');

const pluginsPath = path.join(__dirname, 'plugins');
fs.readdirSync(pluginsPath).forEach((plugin) => {
    if (path.extname(plugin).toLowerCase() === ".js") {
        require(path.join(pluginsPath, plugin));
    }
});
console.log('✅ Plugins Loaded:', commands.length);


const Gifted = new Client({
    authStrategy: new LocalAuth({ dataPath: './auth' }),
    puppeteer: { 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

Gifted.on('qr', (qr) => {
    console.log('QR RECEIVED:', qr);
});

Gifted.on('authenticated', () => {
    console.log('🔑 Authenticated');
});

Gifted.on('ready', () => {
    console.log('🚀 Bot is ready!');
    const adminNumber = "254762016957@c.us";
    Gifted.sendMessage(adminNumber, '🤖 Bot Integrated!');
});

Gifted.on('message', async msg => {
    try {
        const text = msg.body;
        if (text.startsWith('!')) {
            const cmd = text.split(' ')[0].slice(1).toLowerCase();
            const args = text.split(' ').slice(1);
            const quoted = msg.hasQuotedMsg ? await msg.getQuotedMessage() : null;
            
            const command = commands.find(c => 
                c.pattern.toLowerCase() === cmd || 
                (c.alias && c.alias.includes(cmd)));
            
            if (command) {
                // console.log(`Executing: ${command.pattern}`);

                const isOwner = msg.from.replace(/@.*/, "") === "2547xxxxxxxx";
                
                const context = {
                    from: msg.from,
                    quoted,
                    body: text,
                    args,
                    q: args.join(' '),
                    pushname: msg._data.notifyName,
                    isMe: msg.fromMe,
                    isOwner,
                    reply: (text) => msg.reply(text),
                    react: (emoji) => msg.react(emoji)
                };
                
                await command.function(Gifted, msg, context);
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }
});

Gifted.initialize();
