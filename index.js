require('dotenv').config()
const Database = require('better-sqlite3')
const { Client } = require('discord.js')
const { uploadFile } = require('./upload.js')
const { calculateBonus } = require('./bonus.js')

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
const WEEK = 604800
const START = 1612656000 // Sunday, February 7, 2021 12:00:00 AM
const DB_PATH = '/home/ec2-user/db/counting.db'

let lastCheckedWeek = -1

function getWeekNumber(timestamp = null) {
  if (timestamp === null) {
    const now = new Date()  
    const utcMilllisecondsSinceEpoch = now.getTime() + (now.getTimezoneOffset() * 60 * 1000)  
    timestamp = utcMilllisecondsSinceEpoch
  }
  return Math.floor((Math.round(timestamp / 1000) - START) / WEEK) + 1
}

// Check if they followed the rules
function validCount(messages, skipUserValidation=false) {
  let foul = FOUL_TYPES['ALL_GOOD'];
  let userCache = [];
  let prevNumber = 0;
  for (const message of messages) {
    if (userCache.includes(message.author.id) && !skipUserValidation) {
      console.log("Failed user validation", messages)
      foul = FOUL_TYPES['HASTY']
      break
    }
    userCache.push(message.author.id)

    if (message.content.match(/[0-9]+/g) === null) {
      console.log("Failed regex validation", messages)
      foul = FOUL_TYPES['BAD_NUMBER']
      break
    }
    
    if (prevNumber > 0 && (+message.content) !== prevNumber - 1) {
      console.log("Failed number validation", messages)
      foul = FOUL_TYPES['BAD_COUNT']
      break
    }
    prevNumber = (+message.content);
  }
  return foul;
}

function addError(message, foul) {
  let updatedCount = 0
  const db = new Database(DB_PATH);
  const user = db.prepare(`SELECT * FROM counters WHERE snowflake  = ?`).get(message.author.id);
  if (user) {
    updatedCount = user[FOUL_COLUMNS[foul]] + 1
  } else {
    db.prepare(`INSERT INTO counters(snowflake,username,discriminator,avatar) VALUES(?,?,?,?) ON CONFLICT(snowflake) DO UPDATE SET username=excluded.username,discriminator=excluded.discriminator,avatar=excluded.avatar`).run(message.author.id, message.author.username, message.author.discriminator, message.author.avatar);
    updatedCount = 1
  }
  db.prepare(`UPDATE counters SET ${FOUL_COLUMNS[foul]} = ? WHERE snowflake = ?`).run(updatedCount, message.author.id);
  db.close();
}

async function weekCounts(message) {
  const current_week = getWeekNumber(message.createdTimestamp)
  let db = new Database(DB_PATH);
  const recent = db.prepare(`SELECT MAX(week) as last_week FROM weekmessages`).get();
  db.close();
  if (recent.last_week != current_week) {
    lastCheckedWeek = current_week
    console.log("First message of a new week.", current_week)
    // Currently just storing one as reference
    db = new Database(DB_PATH);
    db.prepare(`INSERT INTO weekmessages(message_id,snowflake,week) VALUES(?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET snowflake=excluded.snowflake,week=excluded.week`).run(message.id, message.author.id, current_week);
    db.close();
    // Start building up the weekcounts
    // let collection = await message.channel.messages.fetch({ limit: 2, before: message.id })
    try {
      uploadFile(DB_PATH)
    } catch (e) {
      console.log("uploadFile failed", e)
      await setTimeout(function () {
        try {
          uploadFile(DB_PATH)
          console.log("uploadFile retry succeeded")
        } catch (e) {}
      }, 1000);
    }
  }
}

// DiscordJS Coe
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('message', async (message) => {
  if (message.author.bot) return
  if (message.channel.id !== process.env.COUNTING_CHANNEL) return
  
  const collection = await message.channel.messages.fetch({ limit: 2, before: message.id })
  const messages = [message].concat(collection)
  
  const foul = validCount(messages) 
  if (foul === FOUL_TYPES['ALL_GOOD']) {
    // Success
    // message.react('✅'); 
    const bonus = calculateBonus(message)
    if (bonus) message.react('💎');
  } else {
    // Fail
    // message.react('🚫');
    message.delete()
  
    // Track mistakes
    try {
      addError(message, foul)
    } catch (e) {
      console.log("addError failed", e)
      await setTimeout(function () {
        try {
          addError(message, foul)
          console.log("addError retry succeeded")
        } catch (e) {}
      }, 1000);
    }
  }

  // This if statement can help reduce db accesses, 
  // but isn't perfect since resets when the process restarts
  if (getWeekNumber(message.createdTimestamp) > lastCheckedWeek) {
    // Get week counts once a week
    try {
      weekCounts(message)
    } catch (e) {
      console.log("weekCounts failed", e)
      await setTimeout(function () {
        try {
          weekCounts(message)
          console.log("weekCounts retry succeeded")
        } catch (e) {}
      }, 1000);
    }
  }
});

client.login(process.env.COUNTING_BOT);
