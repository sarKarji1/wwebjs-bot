const { MessageMedia, Client, LocalAuth } = require('whatsapp-web.js');
const { gmd, commands } = require('./hendler');

module.exports = {
  gmd,
  Client, 
  commands,
  LocalAuth,
  MessageMedia
};
