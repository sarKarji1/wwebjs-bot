require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const qrcode = require('qrcode');
const { gmd, commands, Client, LocalAuth, MessageMedia } = require('./lib');

// ===== EXPRESS SERVER SETUP =====
const app = express();
const PORT = process.env.PORT || 8000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ===== GLOBAL STATE =====
let activeAuthMethod = null; // 'terminal', 'web-qr', or 'web-pair'
let terminalAuthAvailable = true;
let webAuthAvailable = true;
let isAuthenticated = false;

// ===== CONFIGURATION =====
const CONFIG = {
    PREFIX: ".",
    BOT_MODE: "private",
    ALLOWED_GROUPS: process.env.ALLOWED_GROUPS ? process.env.ALLOWED_GROUPS.split(',') : [],
    BLOCKED_USERS: process.env.BLOCKED_USERS ? process.env.BLOCKED_USERS.split(',') : [],
    ALLOWED_NUMBERS: process.env.ALLOWED_NUMBERS ? process.env.ALLOWED_NUMBERS.split(',') : []
};

// .ENV
const BOT_NUMBER = process.env.BOT_NUMBER || "254728782591";
const OWNER_NUMBER = process.env.OWNER_NUMBER || "254762016957";
const AUTH_PATH = process.env.AUTH_PATH || './auth';
const HEADLESS = process.env.HEADLESS !== 'true';

// ===== PLUGINS SETUP =====
const pluginsPath = path.join(__dirname, 'plugins');
fs.readdirSync(pluginsPath).forEach((plugin) => {
    if (path.extname(plugin).toLowerCase() === ".js") {
        require(path.join(pluginsPath, plugin));
    }
});
console.log('✅ Plugins Loaded:', commands.length);

// ===== CLIENT SETUP =====
const Gifted = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
    puppeteer: { 
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    },
    takeoverOnConflict: true,
    restartOnAuthFail: true
});

// ===== AUTHENTICATION HANDLERS =====
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
let pairingCodeRequested = false;
let authMethod = null;
let webClients = new Map();

// ===== WEB AUTHENTICATION ENDPOINTS =====
app.get('/', (req, res) => {
    if (isAuthenticated) {
        return res.send('API is Online');
    }
    if (activeAuthMethod && activeAuthMethod !== 'web') {
        return res.status(403).send('Authentication already in progress via terminal');
    }
    activeAuthMethod = 'web';
    terminalAuthAvailable = false;
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/qr', async (req, res) => {
    if (isAuthenticated) {
        return res.status(403).json({ 
            success: false, 
            error: 'Already authenticated' 
        });
    }
    if (activeAuthMethod && activeAuthMethod !== 'web-qr') {
        return res.status(403).json({ 
            success: false, 
            error: 'Another authentication method is already in progress' 
        });
    }
    
    activeAuthMethod = 'web-qr';
    terminalAuthAvailable = false;
    const clientId = `session`;
    
    try {
        const client = new Client({
            authStrategy: new LocalAuth({ clientId, dataPath: AUTH_PATH }),
            puppeteer: { 
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        webClients.set(clientId, client);

        client.on('qr', async (qr) => {
            try {
                const qrImage = await qrcode.toDataURL(qr);
                res.json({ 
                    success: true, 
                    qr: qrImage,
                    message: 'Scan the QR code with WhatsApp to authenticate. Session will be generated automatically.'
                });
            } catch (error) {
                console.error('QR Generation Error:', error);
                if (!res.headersSent) {
                    res.status(500).json({ 
                        success: false, 
                        error: 'QR generation failed' 
                    });
                }
                client.destroy().catch(console.error);
                webClients.delete(clientId);
                activeAuthMethod = null;
                terminalAuthAvailable = true;
            }
        });

        client.on('authenticated', () => {
            console.log(`🔑 Client ${clientId} authenticated`);
            isAuthenticated = true;
        });

        client.on('ready', () => {
            console.log(`🌐 Client ${clientId} ready`);
            // Transfer session to main client
            Gifted.initialize().catch(console.error);
            client.destroy().catch(console.error);
            webClients.delete(clientId);
            activeAuthMethod = null;
            isAuthenticated = true;
        });

        client.on('auth_failure', (msg) => {
            console.error(`❌ Client ${clientId} auth failure:`, msg);
            if (!res.headersSent) {
                res.status(500).json({ 
                    success: false, 
                    error: 'Authentication failed' 
                });
            }
            client.destroy().catch(console.error);
            webClients.delete(clientId);
            activeAuthMethod = null;
            terminalAuthAvailable = true;
            isAuthenticated = false;
        });

        await client.initialize();
    } catch (error) {
        console.error('Web Auth Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ 
                success: false, 
                error: 'Client initialization failed' 
            });
        }
        webClients.get(clientId)?.destroy().catch(console.error);
        webClients.delete(clientId);
        activeAuthMethod = null;
        terminalAuthAvailable = true;
        isAuthenticated = false;
    }
});

app.post('/api/pair', async (req, res) => {
    if (isAuthenticated) {
        return res.status(403).json({ 
            success: false, 
            error: 'Already authenticated' 
        });
    }
    if (activeAuthMethod && activeAuthMethod !== 'web-pair') {
        return res.status(403).json({ 
            success: false, 
            error: 'Another authentication method is already in progress' 
        });
    }
    
    activeAuthMethod = 'web-pair';
    terminalAuthAvailable = false;
    const { phoneNumber } = req.body;
    const clientId = `session`;
    
    if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
        activeAuthMethod = null;
        terminalAuthAvailable = true;
        return res.status(400).json({ 
            success: false, 
            error: 'Valid phone number required (10-15 digits)' 
        });
    }

    try {
        console.log(`Initializing client for pairing with ${phoneNumber}`);
        const client = new Client({
            authStrategy: new LocalAuth({ clientId, dataPath: AUTH_PATH }),
            puppeteer: { 
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process'
                ],
                executablePath: process.env.CHROME_PATH || undefined
            }
        });

        webClients.set(clientId, client);

        let isReady = false;
        const initTimeout = 1200000; // 1 min seconds timeout
        
        const initPromise = new Promise((resolve, reject) => {
            client.on('loading_screen', (percent, message) => {
                console.log(`Loading: ${percent}% ${message || ''}`);
            });

            client.on('authenticated', () => {
                console.log('🔑 Client authenticated');
                isAuthenticated = true;
            });

            client.on('auth_failure', msg => {
                console.error('❌ Auth failure:', msg);
                reject(new Error(`Authentication failed: ${msg}`));
            });

            client.on('ready', () => {
                console.log('🌐 Client ready');
                isReady = true;
                resolve();
            });

            client.on('disconnected', (reason) => {
                console.log('🔌 Client disconnected:', reason);
                if (!isReady) {
                    reject(new Error(`Client disconnected: ${reason}`));
                }
            });
        });

        await client.initialize();
        console.log('Client initialization started...');

        await Promise.race([
            initPromise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Client initialization timeout')), initTimeout)
            )
        ]);

        console.log('Client ready, requesting pairing code...');
        const pairingCode = await client.requestPairingCode(phoneNumber);
        console.log(`Pairing code generated for ${phoneNumber}`);

        res.json({ 
            success: true, 
            pairingCode: pairingCode,
            message: 'Enter this code in your WhatsApp linked devices section'
        });

        client.on('ready', () => {
            console.log('🌐 Paired session ready');
            Gifted.initialize().catch(console.error);
            client.destroy().catch(console.error);
            webClients.delete(clientId);
            activeAuthMethod = null;
            isAuthenticated = true;
        });

    } catch (error) {
        console.error('❌ Pairing Error:', error);
        webClients.get(clientId)?.destroy().catch(console.error);
        webClients.delete(clientId);
        activeAuthMethod = null;
        terminalAuthAvailable = true;
        isAuthenticated = false;
        
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: 'Failed to generate pairing code. Please try again.'
        });
    }
});

// ===== TERMINAL AUTHENTICATION =====
function promptAuthMethod() {
    if (!terminalAuthAvailable) {
        console.log('\n⚠️ Terminal authentication is not available (web authentication in progress)');
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        console.log('\nChoose Authentication Method:');
        console.log('1. QR Code');
        console.log('2. Pairing Code');
        
        const askForChoice = () => {
            rl.question('Enter Choice (1/2): ', (answer) => {
                const choice = answer.trim();
                if (choice === '1' || choice === '2') {
                    activeAuthMethod = 'terminal';
                    webAuthAvailable = false;
                    resolve(choice === '2' ? 'pairing' : 'qr');
                } else {
                    console.log('\n❌ Invalid choice. Please enter 1 or 2');
                    askForChoice();
                }
            });
        };
        
        askForChoice();
    });
}

Gifted.on('qr', async (qr) => {
    if (pairingCodeRequested) return;
    if (activeAuthMethod && activeAuthMethod !== 'terminal') return;

    if (!authMethod && !process.env.AUTH_TYPE) {
        try {
            authMethod = await promptAuthMethod();
            if (!authMethod) return; // Authentication not available
        } catch (error) {
            console.error('\nAuthentication method selection error:', error);
            return;
        }
    }

    if (authMethod === 'pairing' || process.env.AUTH_TYPE === 'pairing-code') {
        console.log('\n🔑 Pairing Code Requested');
        
        const askForPhoneNumber = () => {
            rl.question('Enter Your Phone Number (with country code, e.g. 254712345678): ', async (phoneNumber) => {
                if (!/^\d{10,15}$/.test(phoneNumber)) {
                    console.log('\n❌ Invalid phone number format. Please try again.');
                    askForPhoneNumber();
                    return;
                }

                try {
                    const pairingCode = await Gifted.requestPairingCode(phoneNumber);
                    console.log(`\nPairing code: ${pairingCode}`);
                    console.log('Enter this Code in WhatsApp: Settings → Linked Devices');
                    pairingCodeRequested = true;
                } catch (error) {
                    console.error('\nError Requesting Pairing Code:', error);
                    console.log('\nWould you like to:');
                    console.log('1. Try entering phone number again');
                    console.log('2. Switch to QR code authentication');
                    
                    rl.question('Enter choice (1/2): ', (choice) => {
                        if (choice.trim() === '2') {
                            showQrCode(qr);
                        } else {
                            askForPhoneNumber();
                        }
                    });
                }
            });
        };
        
        askForPhoneNumber();
    } else {
        showQrCode(qr);
    }
});

function showQrCode(qr) {
    console.log('\nQR RECEIVED:');
    try {
        require('qrcode-terminal').generate(qr, { small: true });
    } catch (e) {
        console.log('Scan this QR Code with Your Phone:');
        console.log(qr);
    }
}

Gifted.on('authenticated', () => {
    console.log('\n🔑 Logged In');
    isAuthenticated = true;
    cleanupReadline();
});

Gifted.on('auth_failure', msg => {
    console.error('\nAUTH FAILURE:', msg);
    cleanupReadline();
    activeAuthMethod = null;
    terminalAuthAvailable = true;
    webAuthAvailable = true;
    isAuthenticated = false;
});

Gifted.on('ready', () => {
    console.log('\n🚀 Bot is Online!');
    console.log(`🔣 Prefix: ${CONFIG.PREFIX}`);
    console.log(`🛠 Mode: ${CONFIG.BOT_MODE}`);
    console.log(`🔌 Auth Method: ${authMethod || process.env.AUTH_TYPE || 'qr-code'}`);
    
    Gifted.sendMessage(`${OWNER_NUMBER}@c.us`, 
        `🤖 Bot is online!\n` +
        `Prefix: ${CONFIG.PREFIX}\n` +
        `Mode: ${CONFIG.BOT_MODE}\n` +
        `Auth Method: ${authMethod}`)
        .catch(console.error);
    
    cleanupReadline();
    activeAuthMethod = null;
    terminalAuthAvailable = true;
    webAuthAvailable = true;
    isAuthenticated = true;
});

function cleanupReadline() {
    if (rl) {
        rl.close();
        rl.removeAllListeners();
    }
}

// ===== UTILITY FUNCTIONS =====
function isOwner(msg) {
    return msg.from.replace(/@.*/, "") === OWNER_NUMBER;
}

function isBotSelf(msg) {
    return msg.from.replace(/@.*/, "") === BOT_NUMBER;
}

function isAllowedNumber(msg) {
    const sender = msg.from.replace(/@.*/, "");
    return CONFIG.ALLOWED_NUMBERS.includes(sender);
}

function isGroup(msg) {
    return msg.from.endsWith('@g.us');
}

function isAdminCommand(command) {
    const adminCommands = ['prefix', 'mode'];
    return command && adminCommands.includes(command.pattern);
}

function isAllowed(msg, command) {
    const sender = msg.from.replace(/@.*/, "");
    
    // Blocked users check
    if (CONFIG.BLOCKED_USERS.includes(sender)) return false;
    
    // Always allow owner and bot itself (even in private mode)
    if (isOwner(msg) || isBotSelf(msg)) return true;
    
    // Check allowed numbers (can use non-admin commands in any mode)
    if (isAllowedNumber(msg)) {
        return !isAdminCommand(command);
    }
    
    // Mode-based restrictions for everyone else
    switch (CONFIG.BOT_MODE.toLowerCase()) {
        case "public": return !isAdminCommand(command);
        case "private": return false;
        case "inbox-only": return !isGroup(msg) && !isAdminCommand(command);
        case "groups-only": return isGroup(msg) && !isAdminCommand(command);
        default: return false;
    }
}

function isCommand(text) {
    return text.startsWith(CONFIG.PREFIX);
}

function getCommand(text) {
    return text.slice(CONFIG.PREFIX.length).split(' ')[0].toLowerCase();
}

// ===== MESSAGE HANDLER =====
Gifted.on('message', async msg => {
    try {
        if (msg.from === 'status@broadcast' || !isCommand(msg.body)) return;
        
        const cmd = getCommand(msg.body);
        const args = msg.body.split(' ').slice(1);
        const quoted = msg.hasQuotedMsg ? await msg.getQuotedMessage() : null;
        
        const command = commands.find(c => 
            c.pattern.toLowerCase() === cmd || 
            (c.alias && c.alias.includes(cmd)));
        
        if (command) {
            console.log(`Executing: ${CONFIG.PREFIX}${command.pattern} from ${msg.from}`);
            
            if (!isAllowed(msg, command)) {
                if (isAdminCommand(command)) {
                    return await msg.reply("🚫 Owner Commands are Restricted");
                }
                const modeMessages = {
                    "private": "🔒 Bot is Currently Private",
                    "inbox-only": "📩 Bot Only Works in Private Chats",
                    "groups-only": "👥 Bot Only Works in Groups"
                };
                return await msg.reply(modeMessages[CONFIG.BOT_MODE] || "🚫 Command Not Allowed");
            }

            const context = {
                prefix: CONFIG.PREFIX,
                from: msg.from,
                quoted,
                body: msg.body,
                args,
                q: args.join(' '),
                pushname: msg._data.notifyName,
                isMe: msg.fromMe,
                isOwner: isOwner(msg),
                isBot: isBotSelf(msg),
                isAllowedNumber: isAllowedNumber(msg),
                isGroup: isGroup(msg),
                reply: (text) => msg.reply(text),
                react: (emoji) => msg.react(emoji)
            };
            
            await command.function(Gifted, msg, context);
        }
    } catch (error) {
        console.error('Message Handler Error:', error);
        Gifted.sendMessage(`${OWNER_NUMBER}@c.us`, 
            `⚠️ Error: ${error.message}`)
            .catch(console.error);
    }
});

// ===== MANAGEMENT COMMANDS =====
gmd({
    pattern: "prefix",
    fromMe: true,
    desc: "Change command prefix (Owner only)",
    usage: `${CONFIG.PREFIX}prefix <new_prefix>`
}, async (Gifted, msg, { args, reply }) => {
    if (!args[0]) return await reply(`Current prefix: ${CONFIG.PREFIX}`);
    CONFIG.PREFIX = args[0];
    await reply(`✅ Command Prefix Changed to: ${CONFIG.PREFIX}`);
});

gmd({
    pattern: "mode",
    fromMe: true,
    desc: "Change bot mode (Owner only)",
    usage: `${CONFIG.PREFIX}mode <public|private|inbox-only|groups-only>`
}, async (Gifted, msg, { args, reply }) => {
    const newMode = args[0]?.toLowerCase();
    const validModes = ["public", "private", "inbox-only", "groups-only"];
    
    if (!newMode || !validModes.includes(newMode)) {
        return await reply(`Current mode: ${CONFIG.BOT_MODE}\nValid modes: ${validModes.join(", ")}`);
    }
    
    CONFIG.BOT_MODE = newMode;
    await reply(`✅ Bot Mode Changed to: ${newMode}`);
});

// ===== MESSAGE SENDING API =====
app.post('/api/sendmessage', async (req, res) => {
    const { number, message, type, mediaUrl, filename, caption } = req.body;
    
    if (!number || !/^\d{10,15}$/.test(number)) {
        return res.status(400).json({ success: false, error: 'Invalid WhatsApp number' });
    }

    try {
        const chatId = `${number}@c.us`;
        
        if (type === 'media' && mediaUrl) {
            const media = await MessageMedia.fromUrl(mediaUrl, {
                unsafeMime: true,
                filename: filename || `file_${Date.now()}`
            });
            
            await Gifted.sendMessage(chatId, media, { caption });  

        } else if (message) {
            await Gifted.sendMessage(chatId, message);
        } else {
            return res.status(400).json({ success: false, error: 'Message content required' });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Message Sending Error:', error);
        res.status(500).json({ success: false, error: 'Failed to send message' });
    }
});


// Start everything
app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
    if (!activeAuthMethod) {
        Gifted.initialize();
    }
});

// Clean up on exit
process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await Gifted.sendMessage(`${OWNER_NUMBER}@c.us`, '🛑 Bot shutting down')
        .catch(console.error);
        
    // Cleanup all web clients
    for (const [clientId, client] of webClients) {
        await client.destroy().catch(console.error);
        webClients.delete(clientId);
    }
    
    if (rl) {
        rl.close();
        rl.removeAllListeners();
    }
    
    await Gifted.destroy();
    process.exit(0);
});
