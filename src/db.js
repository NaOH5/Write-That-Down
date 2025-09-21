const Database = require('better-sqlite3');
const db = new Database('./logger.db');

// Create tables
db.prepare(`
CREATE TABLE IF NOT EXISTS guilds (
  guildId TEXT PRIMARY KEY,
  globalLogChannel TEXT
)`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS specificLogs (
  guildId TEXT,
  type TEXT,
  channelId TEXT,
  PRIMARY KEY (guildId, type)
)`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS toggles (
  guildId TEXT,
  type TEXT,
  enabled INTEGER,
  PRIMARY KEY (guildId, type)
)`).run();

// ---- Functions ----

// Global log channel
function setGlobalLog(guildId, channelId) {
  db.prepare(`
    INSERT INTO guilds (guildId, globalLogChannel) VALUES (?, ?)
    ON CONFLICT(guildId) DO UPDATE SET globalLogChannel=excluded.globalLogChannel
  `).run(guildId, channelId);
}

function getGlobalLog(guildId) {
  const row = db.prepare(`SELECT globalLogChannel FROM guilds WHERE guildId=?`).get(guildId);
  return row?.globalLogChannel || null;
}

// Specific log channels
function setSpecificLog(guildId, type, channelId) {
  db.prepare(`
    INSERT INTO specificLogs (guildId, type, channelId) VALUES (?, ?, ?)
    ON CONFLICT(guildId, type) DO UPDATE SET channelId=excluded.channelId
  `).run(guildId, type, channelId);
}

function getSpecificLog(guildId, type) {
  const row = db.prepare(`SELECT channelId FROM specificLogs WHERE guildId=? AND type=?`).get(guildId, type);
  return row?.channelId || null;
}

// Toggle log types
function toggleLog(guildId, type) {
  const current = db.prepare(`SELECT enabled FROM toggles WHERE guildId=? AND type=?`).get(guildId, type);
  const newState = current ? current.enabled ^ 1 : 0; // if undefined default ON
  db.prepare(`
    INSERT INTO toggles (guildId, type, enabled) VALUES (?, ?, ?)
    ON CONFLICT(guildId, type) DO UPDATE SET enabled=excluded.enabled
  `).run(guildId, type, newState);
  return newState === 1;
}

function isLogEnabled(guildId, type) {
  const row = db.prepare(`SELECT enabled FROM toggles WHERE guildId=? AND type=?`).get(guildId, type);
  return row ? !!row.enabled : true; // default enabled
}

function resetSpecificLogs(guildId) {
  db.prepare(`DELETE FROM specificLogs WHERE guildId=?`).run(guildId);
}

module.exports = {
  setGlobalLog, getGlobalLog,
  setSpecificLog, getSpecificLog,
  toggleLog, isLogEnabled,
  resetSpecificLogs 
};
