const { 
  Client, GatewayIntentBits, Partials, Events, 
  SlashCommandBuilder, REST, Routes, PermissionsBitField, EmbedBuilder,
  AuditLogEvent   // <-- ADD THIS
} = require("discord.js");
require("dotenv").config();
const {
  setGlobalLog, getGlobalLog,
  setSpecificLog, getSpecificLog,
  toggleLog, isLogEnabled,
  resetSpecificLogs
} = require("./db");

// ---- Bot Setup ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildInvites
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Loggable event types
const logTypes = [
  "messageDeleted", "messageEdited",
  "reactionAdded", "reactionRemoved",
  "vcJoined", "vcLeft", "vcMoved",
  "channelCreated", "channelUpdated", "channelDeleted",
  "userJoined", "userLeft",
  "roleCreated", "roleUpdated", "roleDeleted",
  "roleGiven", "roleTaken",
  "inviteCreated", "inviteDeleted"
];

// ---- Slash Commands ----
const commands = [
  new SlashCommandBuilder()
    .setName("setlogchannel")
    .setDescription("Set the global log channel")
    .addStringOption(opt => opt.setName("channelid").setDescription("Channel ID").setRequired(true)),
  new SlashCommandBuilder()
    .setName("specificlogging")
    .setDescription("Set a specific channel for a log type")
    .addStringOption(opt => opt.setName("channelid").setDescription("Channel ID").setRequired(true))
    .addStringOption(opt => opt.setName("type").setDescription("Log type").setRequired(true)
      .addChoices(...logTypes.map(t => ({ name: t, value: t })))),
  new SlashCommandBuilder()
    .setName("togglelog")
    .setDescription("Enable/Disable a log type")
    .addStringOption(opt => opt.setName("type").setDescription("Log type").setRequired(true)
      .addChoices(...logTypes.map(t => ({ name: t, value: t })))),
  new SlashCommandBuilder()
    .setName("resetspecifics")
    .setDescription("Reset all specific log channels to the global log channel")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); } 
  catch (err) { console.error(err); }
});

// ---- Slash Command Handler ----
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
    return interaction.reply({ content: "❌ Need Administrator perms.", ephemeral: true });

  const guildId = interaction.guild.id;
  if (interaction.commandName === "setlogchannel") {
    const channelId = interaction.options.getString("channelid");
    setGlobalLog(guildId, channelId);
    return interaction.reply(`✅ Global log channel set to <#${channelId}>`);
  }
  if (interaction.commandName === "specificlogging") {
    const channelId = interaction.options.getString("channelid");
    const type = interaction.options.getString("type");
    setSpecificLog(guildId, type, channelId);
    return interaction.reply(`✅ Specific log for **${type}** set to <#${channelId}>`);
  }
  if (interaction.commandName === "togglelog") {
    const type = interaction.options.getString("type");
    const newState = toggleLog(guildId, type);
    return interaction.reply(`✅ Log type **${type}** is now **${newState ? "ENABLED" : "DISABLED"}**`);
  }
  if (interaction.commandName === "resetspecifics") {
    resetSpecificLogs(guildId);
    return interaction.reply("✅ All specific log channels have been reset to the global log channel.");
  }
});

// ---- Send Log Function ----
async function sendLog(guild, type, embed) {
  const state = isLogEnabled(guild.id, type);
  if (state === false) return;

  const channelId = getSpecificLog(guild.id, type) || getGlobalLog(guild.id);
  if (!channelId) return;

  let channel = guild.channels.cache.get(channelId);
  if (!channel) {
    try { channel = await guild.channels.fetch(channelId); } catch { return; }
  }
  channel.send({ embeds: [embed] }).catch(err => console.error("Log send failed:", err));
}

// ---- Event Listeners ----

// Message Deleted
client.on(Events.MessageDelete, async msg => {
  if (!msg.guild) return;

  let deleter = msg.author.tag; // fallback to author
  try {
    const audit = await msg.guild.fetchAuditLogs({
      type: AuditLogEvent.MessageDelete,
      limit: 1
    }).then(logs => logs.entries.first());

    // Use audit log executor only if deletion happened within 5 seconds
    if (audit && (Date.now() - audit.createdTimestamp) < 5000) {
      deleter = audit.executor.tag;
    }
  } catch (err) {
    console.error("Failed to fetch audit logs:", err);
  }

  const embed = new EmbedBuilder()
    .setTitle("🗑️ Message Deleted")
    .setDescription(`A message was deleted in ${msg.channel}`)
    .setColor("Red")
    .addFields(
      { name: "Content", value: msg.content || "(embed/attachment)" },
      { name: "Deleter", value: deleter }
    )
    .setTimestamp();

  sendLog(msg.guild, "messageDeleted", embed);
});


// Message Edited
client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
  if (!newMsg.guild || oldMsg.content === newMsg.content) return;
  const embed = new EmbedBuilder()
    .setTitle("✏️ Message Edited")
    .setDescription(`${newMsg.author.tag} edited a message in ${newMsg.channel}`)
    .setColor("Orange")
    .addFields(
      { name: "Before", value: oldMsg.content || "(embed/attachment)" },
      { name: "After", value: newMsg.content || "(embed/attachment)" }
    )
    .setTimestamp();
  sendLog(newMsg.guild, "messageEdited", embed);
});

// Member Join / Leave
client.on(Events.GuildMemberAdd, member => {
  const embed = new EmbedBuilder()
    .setTitle("👋 User Joined")
    .setDescription(`${member.user.tag} joined the server.`)
    .setColor("Green")
    .setTimestamp();
  sendLog(member.guild, "userJoined", embed);
});

client.on(Events.GuildMemberRemove, member => {
  const embed = new EmbedBuilder()
    .setTitle("🚪 User Left")
    .setDescription(`${member.user.tag} left the server.`)
    .setColor("Red")
    .setTimestamp();
  sendLog(member.guild, "userLeft", embed);
});

// Roles
client.on(Events.GuildRoleCreate, async role => {
  const audit = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).then(l => l.entries.first());
  const embed = new EmbedBuilder()
    .setTitle("➕ Role Created")
    .setDescription(`Role **${role.name}** was created.`)
    .setColor("Blue")
    .setTimestamp();
  if (audit?.executor) embed.addFields({ name: "Created by", value: audit.executor.tag });
  sendLog(role.guild, "roleCreated", embed);
});

client.on(Events.GuildRoleDelete, async role => {
  const audit = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 }).then(l => l.entries.first());
  const embed = new EmbedBuilder()
    .setTitle("❌ Role Deleted")
    .setDescription(`Role **${role.name}** was deleted.`)
    .setColor("Red")
    .setTimestamp();
  if (audit?.executor) embed.addFields({ name: "Deleted by", value: audit.executor.tag });
  sendLog(role.guild, "roleDeleted", embed);
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  const audit = await newRole.guild.fetchAuditLogs({ type: AuditLogEvent.RoleUpdate, limit: 1 }).then(l => l.entries.first());
  const embed = new EmbedBuilder()
    .setTitle("🔧 Role Updated")
    .setDescription(`Role **${newRole.name}** was updated.`)
    .setColor("Orange")
    .addFields(
      { name: "Before", value: oldRole.name },
      { name: "After", value: newRole.name }
    )
    .setTimestamp();
  if (audit?.executor) embed.addFields({ name: "Updated by", value: audit.executor.tag });
  sendLog(newRole.guild, "roleUpdated", embed);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const guild = newMember.guild;
  // Roles added
  const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  addedRoles.forEach(async role => {
    const audit = await guild.fetchAuditLogs({ type: AuditLogEvent.GuildMemberUpdate, limit: 1 }).then(l => l.entries.first());
    const embed = new EmbedBuilder()
      .setTitle("➕ Role Given")
      .setDescription(`${newMember.user.tag} was given role **${role.name}**`)
      .setColor("Green")
      .setTimestamp();
    if (audit?.executor) embed.addFields({ name: "By", value: audit.executor.tag });
    sendLog(guild, "roleGiven", embed);
  });
  // Roles removed
  const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
  removedRoles.forEach(async role => {
    const audit = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 1 }).then(l => l.entries.first());
    const embed = new EmbedBuilder()
      .setTitle("➖ Role Taken")
      .setDescription(`${newMember.user.tag} had role **${role.name}** removed`)
      .setColor("Red")
      .setTimestamp();
    if (audit?.executor) embed.addFields({ name: "By", value: audit.executor.tag });
    sendLog(guild, "roleTaken", embed);
  });
});

// Channels
client.on(Events.ChannelCreate, async channel => {
  const audit = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 1 }).then(l => l.entries.first());
  const embed = new EmbedBuilder()
    .setTitle("📂 Channel Created")
    .setDescription(`Channel **${channel.name}** was created.`)
    .setColor("Blue")
    .setTimestamp();
  if (audit?.executor) embed.addFields({ name: "Created by", value: audit.executor.tag });
  sendLog(channel.guild, "channelCreated", embed);
});

client.on(Events.ChannelDelete, async channel => {
  const audit = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).then(l => l.entries.first());
  const embed = new EmbedBuilder()
    .setTitle("❌ Channel Deleted")
    .setDescription(`Channel **${channel.name}** was deleted.`)
    .setColor("Red")
    .setTimestamp();
  if (audit?.executor) embed.addFields({ name: "Deleted by", value: audit.executor.tag });
  sendLog(channel.guild, "channelDeleted", embed);
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  const audit = await newChannel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelUpdate, limit: 1 }).then(l => l.entries.first());
  const embed = new EmbedBuilder()
    .setTitle("🔧 Channel Updated")
    .setDescription(`Channel **${newChannel.name}** was updated.`)
    .setColor("Orange")
    .addFields(
      { name: "Before", value: oldChannel.name },
      { name: "After", value: newChannel.name }
    )
    .setTimestamp();
  if (audit?.executor) embed.addFields({ name: "Updated by", value: audit.executor.tag });
  sendLog(newChannel.guild, "channelUpdated", embed);
});

// Invites
client.on(Events.GuildInviteCreate, async invite => {
  const audit = await invite.guild.fetchAuditLogs({ type: AuditLogEvent.InviteCreate, limit: 1 }).then(l => l.entries.first());
  const embed = new EmbedBuilder()
    .setTitle("➕ Invite Created")
    .setDescription(`Invite **${invite.code}** was created.`)
    .setColor("Blue")
    .setTimestamp();
  if (audit?.executor) embed.addFields({ name: "Created by", value: audit.executor.tag });
  sendLog(invite.guild, "inviteCreated", embed);
});

client.on(Events.GuildInviteDelete, async invite => {
  const audit = await invite.guild.fetchAuditLogs({ type: AuditLogEvent.InviteDelete, limit: 1 }).then(l => l.entries.first());
  const embed = new EmbedBuilder()
    .setTitle("❌ Invite Deleted")
    .setDescription(`Invite **${invite.code}** was deleted.`)
    .setColor("Red")
    .setTimestamp();
  if (audit?.executor) embed.addFields({ name: "Deleted by", value: audit.executor.tag });
  sendLog(invite.guild, "inviteDeleted", embed);
});

// Reactions
client.on(Events.MessageReactionAdd, (reaction, user) => {
  if (user.bot || !reaction.message.guild) return;
  const embed = new EmbedBuilder()
    .setTitle("➕ Reaction Added")
    .setDescription(`${user.tag} added a reaction in ${reaction.message.channel}`)
    .setColor("Green")
    .addFields({ name: "Emoji", value: `${reaction.emoji}` })
    .setTimestamp();
  sendLog(reaction.message.guild, "reactionAdded", embed);
});

client.on(Events.MessageReactionRemove, (reaction, user) => {
  if (user.bot || !reaction.message.guild) return;
  const embed = new EmbedBuilder()
    .setTitle("➖ Reaction Removed")
    .setDescription(`${user.tag} removed a reaction in ${reaction.message.channel}`)
    .setColor("Orange")
    .addFields({ name: "Emoji", value: `${reaction.emoji}` })
    .setTimestamp();
  sendLog(reaction.message.guild, "reactionRemoved", embed);
});

// Voice Channel
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  if (!oldState.channel && newState.channel) {
    const embed = new EmbedBuilder()
      .setTitle("🔊 VC Joined")
      .setDescription(`${member.user.tag} joined ${newState.channel.name}`)
      .setColor("Green")
      .setTimestamp();
    sendLog(member.guild, "vcJoined", embed);
  } else if (oldState.channel && !newState.channel) {
    const embed = new EmbedBuilder()
      .setTitle("🔇 VC Left")
      .setDescription(`${member.user.tag} left ${oldState.channel.name}`)
      .setColor("Red")
      .setTimestamp();
    sendLog(member.guild, "vcLeft", embed);
  } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
    const embed = new EmbedBuilder()
      .setTitle("🔀 VC Moved")
      .setDescription(`${member.user.tag} moved from ${oldState.channel.name} to ${newState.channel.name}`)
      .setColor("Orange")
      .setTimestamp();
    sendLog(member.guild, "vcMoved", embed);
  }
});

client.login(process.env.TOKEN);
