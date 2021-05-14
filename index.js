require('dotenv').config()

const { Client } = require('discord.js');
const client = new Client({ ws: { intents: ['GUILDS', 'GUILD_MESSAGES'] } });

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

function validCount(messages) {
  let userCache = [];
  let prevNumber = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    
    if (userCache.includes(m.user)) {
      console.log("Failed user validation", messages)
      return false;
    }
    userCache.push(m.user)

    if (m.content.match(/[0-9]+/g) === null) {
      console.log("Failed regex validation", messages)
      return false;
    }
    
    if (prevNumber > 0 && (+m.content) !== prevNumber - 1) {
      console.log("Failed number validation", messages)
      return false;
    }
    prevNumber = (+m.content);
  }
  return true;
}

client.on('message', async (msg) => {
  if (msg.channel.id !== process.env.COUNTING_CHANNEL) {
    return
  }

  let collection = await msg.channel.messages.fetch({limit: 3})
  let messages = collection.map((m) => ({ user: m.author.id, content: m.content }))
  if (validCount(messages)) {
    // Success
    // msg.react('✅'); 
    return
  }
  // Fail
  msg.react('🚫');
});

client.login(process.env.COUNTING_BOT);
