
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { gmd, commands } = require('./handler');

// ===== CONFIGURATION =====
const CONFIG = {
    PREFIX: ".",
    BOT_MODE: "private",
    ALLOWED_GROUPS: process.env.ALLOWED_GROUPS ? process.env.ALLOWED_GROUPS.split(',') : [],
    BLOCKED_USERS: process.env.BLOCKED_USERS ? process.env.BLOCKED_USERS.split(',') : []
};

// Environment variables
const BOT_NUMBER = process.env.BOT_NUMBER || "2547xxxxxxxx";
const OWNER_NUMBER = process.env.OWNER_NUMBER || "254762016957";
const AUTH_PATH = process.env.AUTH_PATH || './auth';
const HEADLESS = process.env.HEADLESS !== 'true';

// ===== BOT SETUP =====
const pluginsPath = path.join(__dirname, 'plugins');
fs.readdirSync(pluginsPath).forEach((plugin) => {
    if (path.extname(plugin).toLowerCase() === ".js") {
        require(path.join(pluginsPath, plugin));
    }
});
console.log('✅ Plugins Loaded:', commands.length);

const Gifted = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
    puppeteer: { 
        headless: HEADLESS,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// ===== AUTHENTICATION HANDLERS =====
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
let pairingCodeRequested = false;
let authMethod = null;

function promptAuthMethod() {
    return new Promise((resolve) => {
        // Set 1-minute timeout
        const timeout = setTimeout(() => {
            console.log('\n⏰ No Selection Made, Defaulting to QR Code');
            rl.close();
            resolve('qr');
        }, 60000);

        console.log('\nChoose Authentication Method:');
        console.log('1. QR Code');
        console.log('2. Pairing Code');
        rl.question('Enter choice (1/2): ', (answer) => {
            clearTimeout(timeout);
            const choice = answer.trim();
            if (choice === '2') {
                resolve('pairing');
            } else {
                resolve('qr');
            }
        });
    });
}

Gifted.on('qr', async (qr) => {
    if (pairingCodeRequested) return;

    if (!authMethod && !process.env.AUTH_TYPE) {
        authMethod = await promptAuthMethod();
    }

    if (authMethod === 'pairing' || process.env.AUTH_TYPE === 'pairing-code') {
        console.log('\n🔑 Pairing Code Requested');
        rl.question('Enter Your Phone Number (with country code, e.g. 254712345678): ', async (phoneNumber) => {
            try {
                const pairingCode = await Gifted.requestPairingCode(phoneNumber);
                console.log(`\nPairing code: ${pairingCode}`);
                console.log('Enter this Code in WhatsApp: Settings → Linked Devices');
                pairingCodeRequested = true;
            } catch (error) {
                console.error('\nError Requesting Pairing Code:', error);
                console.log('Falling Back to QR code...');
                showQrCode(qr);
            }
        });
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
    cleanupReadline();
});

Gifted.on('auth_failure', msg => {
    console.error('\nAUTH FAILURE:', msg);
    cleanupReadline();
});

Gifted.on('ready', () => {
    console.log('\n🚀 Bot is Online!');
    console.log(`🔣 Prefix: ${CONFIG.PREFIX}`);
    console.log(`🛠 Mode: ${CONFIG.BOT_MODE}`);
    console.log(`🔌 Auth Method: ${authMethod || process.env.AUTH_TYPE || 'qr-code'}`);
    
    Gifted.sendMessage(`${OWNER_NUMBER}@c.us`, 
        `🤖 Bot is online!\n` +
        `Prefix: ${CONFIG.PREFIX}\n` +
        `Mode: ${CONFIG.BOT_MODE}`)
        .catch(console.error);
    
    cleanupReadline();
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

function isGroup(msg) {
  return msg.from.endsWith('@g.us');
}

function isAllowed(msg) {
  const sender = msg.from.replace(/@.*/, "");
  
  if (CONFIG.BLOCKED_USERS.includes(sender)) return false;
  if (isOwner(msg) || isBotSelf(msg)) return true;
  
  switch (CONFIG.BOT_MODE.toLowerCase()) {
      case "public": return true;
      case "private": return false;
      case "inbox-only": return !isGroup(msg);
      case "groups-only": return isGroup(msg);
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
      
      if (!isAllowed(msg)) {
          const modeMessages = {
              "private": "🔒 Bot is Currentlt Private",
              "inbox-only": "📩 Bot Only Works in Private Chats",
              "groups-only": "👥 Bot Only Works in Groups"
          };
          return await msg.reply(modeMessages[CONFIG.BOT_MODE] || "🚫 Command Not Allowed");
      }

      const cmd = getCommand(msg.body);
      const args = msg.body.split(' ').slice(1);
      const quoted = msg.hasQuotedMsg ? await msg.getQuotedMessage() : null;
      
      const command = commands.find(c => 
          c.pattern.toLowerCase() === cmd || 
          (c.alias && c.alias.includes(cmd)));
      
      if (command) {
          console.log(`Executing: ${CONFIG.PREFIX}${command.pattern} from ${msg.from}`);
          
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
  desc: "Change command prefix",
  usage: `${CONFIG.PREFIX}prefix <new_prefix>`
}, async (Gifted, msg, { args, reply }) => {
  if (!args[0]) return await reply(`Current prefix: ${CONFIG.PREFIX}`);
  CONFIG.PREFIX = args[0];
  await reply(`✅ Command Prefix Changed to: ${CONFIG.PREFIX}`);
});

gmd({
  pattern: "mode",
  fromMe: true,
  desc: "Change bot mode",
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

Gifted.initialize();

// Clean up on exit
process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await Gifted.sendMessage(`${OWNER_NUMBER}@c.us`, '🛑 Bot shutting down')
        .catch(console.error);
    cleanupReadline();
    await Gifted.destroy();
    process.exit(0);
});
