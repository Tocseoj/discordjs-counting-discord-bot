require('dotenv').config()
const Database = require('better-sqlite3')
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

// Just returns what I need
function reduceMessage(message) {
  return {
    id: message.id,
    user: message.author.id,
    content: message.content,
    createdTimestamp: message.createdTimestamp,
  }
}

// Check if they followed the rules
function validCount(messages, skipUserValidation=false) {
  let foul = FOUL_TYPES['ALL_GOOD'];
  let userCache = [];
  let prevNumber = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    
    if (userCache.includes(m.user) && !skipUserValidation) {
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

function addError(message, foul) {
  let updatedCount = 0
  const db = new Database(DB_PATH);
  const user = db.prepare(`SELECT * FROM counters WHERE snowflake  = ?`).get(message.author.id);
  if (user) {
    updatedCount = user[FOUL_COLUMNS[foul]] + 1
  } else {
    db.prepare(`INSERT INTO counters(snowflake,username,discriminator,avatar) VALUES(?, ?, ?, ?)`).run(message.author.id, message.author.username, message.author.discriminator, message.author.avatar);
    updatedCount = 1
  }
  db.prepare(`UPDATE counters SET ${FOUL_COLUMNS[foul]} = ? WHERE snowflake = ?`).run(updatedCount, message.author.id);
  db.close();
}

async function weekCounts(message) {
  const db = new Database(DB_PATH);
  const recent = db.prepare(`SELECT MAX(week) as last_week FROM weekcounts`).get();
  const current_week = getWeekNumber(message.createdTimestamp)
  if (recent.last_week != current_week) {
    lastCheckedWeek = current_week
    console.log("First message of a new week.", current_week)
    db.prepare(`INSERT INTO weekcounts(snowflake,week,total_count,message_id) VALUES(?, ?, ?, ?)`).run("0", current_week, 0, message.id);
    // Should probably close before calling an ayncronous method
    // let collection = await message.channel.messages.fetch({ limit: 2, before: message.id })
  }
  db.close();
}

// DiscordJS Coe
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('message', async (msg) => {
  if (msg.author.bot) return
  if (msg.channel.id !== process.env.COUNTING_CHANNEL) return
  
  let collection = await msg.channel.messages.fetch({ limit: 2, before: msg.id })
  let messages = [reduceMessage(msg), ...collection.map((m) => reduceMessage(m))]
  
  let foul = validCount(messages) 
  if (foul === FOUL_TYPES['ALL_GOOD']) {
    // Success
    // msg.react('✅'); 
  } else {
    // Fail
    // msg.react('🚫');
    msg.delete()
  
    // Track mistakes
    try {
      addError(msg, foul)
    } catch (e) {
      console.log("addError failed", e)
      await setTimeout(function () {
        addError(msg, foul)
      }, 1000);
    }
  }

  // This if statement can help reduce db accesses, 
  // but isn't perfect since resets when the process restarts
  if (getWeekNumber(msg.createdTimestamp) > lastCheckedWeek) {
    // Get week counts once a week
    try {
      weekCounts(msg)
    } catch (e) {
      console.log("weekCounts failed", e)
      await setTimeout(function () {
        weekCounts(msg)
      }, 1000);
    }
  }
});

client.login(process.env.COUNTING_BOT);
