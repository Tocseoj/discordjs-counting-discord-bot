require('dotenv').config()
const { Database } = require('sqlite3').verbose()
const { Client } = require('discord.js')
const client = new Client({ ws: { intents: ['GUILDS', 'GUILD_MESSAGES'] } })

const FOUL_TYPES =  { 
  "ALL_GOOD": 0, 
  "HASTY": 1, 
  "BAD_NUMBER": 2, 
  "BAD_COUNT": 3,
}
const FOUL_COLUMNS = [
  null,
  'fouls_hasty',
  'fouls_badnumber',
  'fouls_badcount',
]

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

// Just returns what I need
function reduceMessage(message) {
  return {
    id: message.id,
    user: message.author.id,
    content: message.content,
    createdTimestamp: message.createdTimestamp,
  }
}

// Returns the past 3 messages in descending order
function sanityCheckAndFix(messages, messageToCheck) {
  // Sanity Check(s)
  let prevTimestamp = 0;
  let needToSort = false;
  let missingMessageToCheck = true;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];

    if (prevTimestamp > 0 && m.createdTimestamp < prevTimestamp) {
      needToSort = true;
    }
    prevTimestamp = m.createdTimestamp

    if (m.id === messageToCheck.id) {
      missingMessageToCheck = false
    }
  }

  // And Fix(es)
  if (missingMessageToCheck) {
    console.log("Before message is not inclusive!", messages, messageToCheck)
    messages.push(messageToCheck)
    needToSort = true
  }
  if (needToSort) {
    console.log("Not in descending order!", messages, messageToCheck)
    messages.sort((a, b) => b.createdTimestamp - a.createdTimestamp)
  }
  while (messages.length > 3) {
    messages.pop()
  }

  return messages;
}

function validCount(messages) {
  let foul = FOUL_TYPES['ALL_GOOD'];
  let userCache = [];
  let prevNumber = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    
    if (userCache.includes(m.user)) {
      console.log("Failed user validation", messages)
      foul = FOUL_TYPES['HASTY']
      break
    }
    userCache.push(m.user)

    if (m.content.match(/[0-9]+/g) === null) {
      console.log("Failed regex validation", messages)
      foul = FOUL_TYPES['BAD_NUMBER']
      break
    }
    
    if (prevNumber > 0 && (+m.content) !== prevNumber - 1) {
      console.log("Failed number validation", messages)
      foul = FOUL_TYPES['BAD_COUNT']
      break
    }
    prevNumber = (+m.content);
  }
  return foul;
}

client.on('message', async (msg) => {
  if (msg.author.bot) return
  if (msg.channel.id === process.env.COUNTING_CHANNEL) {
    let collection = await msg.channel.messages.fetch({ limit: 3 })
    let messages = collection.map((m) => reduceMessage(m))
    
    let foul = validCount(messages) 
    if (foul === FOUL_TYPES['ALL_GOOD']) {
      // Success
      // msg.react('✅'); 
      return
    }
    // Fail
    msg.react('🚫');
    // msg.delete()
  } else if (msg.channel.id === "768974443434344458") {
    let collection = await msg.channel.messages.fetch({ limit: 3, before: msg.id })
    let messages = collection.map((m) => reduceMessage(m))
    messages = sanityCheckAndFix(messages, reduceMessage(msg))
    
    let foul = validCount(messages) 
    if (foul === FOUL_TYPES['ALL_GOOD']) {
      // Success
      // msg.react('✅'); 
      return
    }
    // Fail
    msg.react('🚫');
    // msg.delete()

    let db = new Database('~/db/counting.db');
    // insert one row into the langs table
    let updatedCount = 0
    let user = await db.get(`SELECT * FROM counters WHERE snowflake  = ?`, [msg.author.id])
    if (user) {
      updatedCount = user[FOUL_COLUMNS[foul]] + 1
    } else {
      await db.run(`INSERT INTO counters(snowflake,username,discriminator,avatar) VALUES(?)`, [msg.author.id, msg.author.username, msg.author.discriminator, msg.author.avatar]);
      updatedCount = 1
    }
    await db.run(`UPDATE counters SET ? = ? WHERE snowflake = ?`, [FOUL_COLUMNS[foul], updatedCount, msg.author.id]);
    db.close();
  }
});

client.login(process.env.COUNTING_BOT);
