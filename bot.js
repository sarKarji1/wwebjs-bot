const { Client, LocalAuth } = require('whatsapp-web.js');
const readline = require('readline');

// Create readline interface for terminal input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './.wwebjs_auth/' 
  }),
  puppeteer: { 
    headless: false
  }
});

let pairingCodeRequested = false;

client.on('qr', async (qr) => {
  console.log('QR RECEIVED (but we\'ll use pairing code instead)');
  
  if (!pairingCodeRequested) {
    // Ask for phone number in terminal
    rl.question('Enter your phone number (with country code, e.g. 1234567890): ', async (phoneNumber) => {
      try {
        const pairingCode = await client.requestPairingCode(phoneNumber);
        console.log(`Pairing code: ${pairingCode}`);
        console.log('Enter this code in your WhatsApp linked devices section');
        pairingCodeRequested = true;
      } catch (error) {
        console.error('Error requesting pairing code:', error);
      }
    });
  }
});

client.on('authenticated', () => {
  console.log('AUTHENTICATED');
  // Session is now stored in ./creds directory
});

client.on('auth_failure', msg => {
  console.error('AUTHENTICATION FAILURE', msg);
});

client.on('ready', () => {
  console.log('Client is ready!');
  rl.close(); // Close the readline interface
});

client.on('message', msg => {
  if (msg.body == '!ping') {
    msg.reply('pong');
  }
});

// Initialize the client
client.initialize();

// Handle process exit
process.on('SIGINT', () => {
  console.log('Shutting down...');
  client.destroy().then(() => process.exit());
});
