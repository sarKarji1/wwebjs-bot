const { Client, LocalAuth } = require('whatsapp-web.js');
const readline = require('readline');

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './auth' }),
  puppeteer: { 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let pairingCodeRequested = false;

client.on('qr', async (qr) => {
  // console.log('QR RECEIVED (but using pairing code instead)');
  
  if (!pairingCodeRequested) {
    rl.question('Enter your phone number (e.g., 2547xxxxxxxx): ', async (phoneNumber) => {
      try {
        const pairingCode = await client.requestPairingCode(phoneNumber);
        console.log(`Pairing code: ${pairingCode}`);
        console.log('Enter this in WhatsApp: Settings → Linked Devices → Link a Device');
        pairingCodeRequested = true;
      } catch (error) {
        console.error('Error:', error);
        process.exit(1);
      }
    });
  }
});

client.on('authenticated', () => console.log('✅ Authenticated'));

client.on('ready', async () => {
  console.log('🚀 Bot is ready!');
  
  const yourNumber = "254762016957"; 
  const formattedNumber = yourNumber.includes('@c.us') ? yourNumber : `${yourNumber}@c.us`;
  
  try {
    await client.sendMessage(formattedNumber, '🤖 *Bot Connected!*');
    console.log(`✅ Notification sent to ${formattedNumber}`);
  } catch (error) {
    console.error('❌ Failed to send notification:', error);
  }
});

// ====== COMMAND HANDLERS ======
client.on('message', async (msg) => {
  const command = msg.body.toLowerCase();

  if (command === '!ping') msg.reply('🏓 pong');
  else if (command === '!time') msg.reply(`⏰ Time: ${new Date().toLocaleTimeString()}`);
  else if (command === '!info') msg.reply('🤖 Bot powered by whatsapp-web.js');
  else if (command === '!help') msg.reply('🛠 Commands: !ping, !time, !info');
});

client.initialize();

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  client.destroy().then(() => process.exit());
});
