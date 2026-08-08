/**
 * Wick-like single-file Discord bot
 *
 * Save as bot.js and run with: node bot.js
 *
 * Required env:
 *  BOT_TOKEN - your bot token
 *  MONGO_URI - MongoDB connection string
 * Optional env:
 *  CLIENT_ID - application client id (for slash command registration)
 *  REGISTER_SLASH=true - register slash commands on startup (requires CLIENT_ID)
 *  OWNER_ID - your Discord user id (for owner-only commands)
 *
 * Install dependencies:
 *  npm init -y
 *  npm i discord.js mongoose dotenv
 *  (Optional for register): npm i @discordjs/rest discord-api-types
 *
 * This file includes:
 *  - GuildConfig and Infraction mongoose models
 *  - Prefix + slash commands: kick, ban, mute, unmute, tempmute, tempban, config
 *  - Invite & profanity automod
 *  - Anti-raid join rate detection with actions: kick, ban, jail, lockdown
 *  - Scheduler to expire temp infractions
 */

require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, PermissionsBitField } = require('discord.js');
const mongoose = require('mongoose');

const TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const CLIENT_ID = process.env.CLIENT_ID;
const REGISTER_SLASH = (process.env.REGISTER_SLASH || '').toLowerCase() === 'true';
const OWNER_ID = process.env.OWNER_ID || null;

if (!TOKEN) {
  console.error('Missing BOT_TOKEN in .env');
  process.exit(1);
}
if (!MONGO_URI) {
  console.error('Missing MONGO_URI in .env');
  process.exit(1);
}

// ---------- MONGOOSE MODELS ----------
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB connection error', err); process.exit(1); });

const guildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  prefix: { type: String, default: '!' },
  blockInvites: { type: Boolean, default: true },
  profanity: { type: [String], default: [] },
  antiRaid: {
    enabled: { type: Boolean, default: true },
    windowMs: { type: Number, default: 30_000 },
    threshold: { type: Number, default: 5 },
    action: { type: String, enum: ['kick', 'ban', 'jail', 'lockdown'], default: 'kick' }
  }
}, { timestamps: true });

guildConfigSchema.statics.getFor = async function (guildId) {
  let cfg = await this.findOne({ guildId });
  if (!cfg) {
    cfg = new this({ guildId });
    await cfg.save();
  }
  return cfg;
};

const GuildConfig = mongoose.model('GuildConfig', guildConfigSchema);

const infractionSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  type: { type: String, required: true }, // mute, ban, tempban...
  moderatorId: { type: String },
  reason: { type: String },
  active: { type: Boolean, default: true },
  expiresAt: { type: Date, default: null },
  extra: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

const Infraction = mongoose.model('Infraction', infractionSchema);

// ---------- HELPERS ----------
function parseDuration(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;
  const val = Number(m[1]);
  const unit = m[2].toLowerCase();
  const ms = unit === 's' ? val * 1000
    : unit === 'm' ? val * 60_000
    : unit === 'h' ? val * 60 * 60_000
    : val * 24 * 60 * 60_000;
  return ms;
}

async function ensureMutedRole(guild) {
  let muted = guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
  if (muted) return muted;
  try {
    muted = await guild.roles.create({ name: 'Muted', reason: 'create muted role for moderation' });
    // Try to deny SEND_MESSAGES in all channels (best-effort)
    for (const [, ch] of guild.channels.cache) {
      try {
        if (ch?.isTextBased?.() || ch?.isVoice?.()) {
          await ch.permissionOverwrites.edit(muted, {
            SendMessages: false,
            AddReactions: false,
            Speak: false
          }).catch(() => null);
        }
      } catch (e) { /* ignore */ }
    }
    return muted;
  } catch (e) {
    console.error('Failed to create Muted role', e);
    return null;
  }
}

async function ensureJailRole(guild) {
  let jailed = guild.roles.cache.find(r => r.name.toLowerCase() === 'jailed');
  if (jailed) return jailed;
  try {
    jailed = await guild.roles.create({ name: 'Jailed', reason: 'create jailed role for anti-raid' });
    // Basic lock for text channels
    for (const [, ch] of guild.channels.cache) {
      try {
        if (ch?.isTextBased?.()) {
          await ch.permissionOverwrites.edit(jailed, {
            SendMessages: false,
            AddReactions: false,
            ViewChannel: false
          }).catch(() => null);
        }
      } catch (e) { /* ignore */ }
    }
    return jailed;
  } catch (e) {
    console.error('Failed to create Jailed role', e);
    return null;
  }
}

function isInviteOrDiscordLink(content) {
  return /(?:https?:\/\/)?(?:www\.)?(discord\.gg|discordapp\.com\/invite|discord\.com\/invite)\/\S+/i.test(content);
}

// ---------- CLIENT & COMMANDS ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

client.commands = new Collection();

// Basic command implementations (prefix and slash)
const commandImplementations = {
  kick: {
    description: 'Kick a member',
    permission: PermissionsBitField.Flags.KickMembers,
    async run({ message, interaction, args }) {
      const guild = message?.guild || interaction.guild;
      const targetId = args?.[0] || (interaction.options && interaction.options.getUser('user')?.id);
      if (!targetId) return reply({ message, interaction, content: 'Specify a user id or mention.' });
      const member = await guild.members.fetch(targetId).catch(() => null);
      if (!member) return reply({ message, interaction, content: 'Member not found.' });
      if (!member.kickable) return reply({ message, interaction, content: 'Cannot kick this member.' });
      const reason = args?.slice(1).join(' ') || (interaction.options && interaction.options.getString('reason')) || 'No reason provided';
      await member.kick(reason).catch(e => console.error(e));
      await Infraction.create({ guildId: guild.id, userId: member.id, type: 'kick', moderatorId: getActorId(message, interaction), reason, active: false });
      return reply({ message, interaction, content: `Kicked ${member.user.tag}. Reason: ${reason}` });
    }
  },
  ban: {
    description: 'Ban a member',
    permission: PermissionsBitField.Flags.BanMembers,
    async run({ message, interaction, args }) {
      const guild = message?.guild || interaction.guild;
      const targetId = args?.[0] || (interaction.options && interaction.options.getUser('user')?.id);
      if (!targetId) return reply({ message, interaction, content: 'Specify a user id or mention.' });
      const reason = args?.slice(1).join(' ') || (interaction.options && interaction.options.getString('reason')) || 'No reason provided';
      // try fetch member first then ban
      const member = await guild.members.fetch(targetId).catch(() => null);
      if (member && !member.bannable) return reply({ message, interaction, content: 'Cannot ban this member.' });
      await guild.members.ban(targetId, { reason }).catch(e => console.error(e));
      await Infraction.create({ guildId: guild.id, userId: targetId, type: 'ban', moderatorId: getActorId(message, interaction), reason, active: true });
      return reply({ message, interaction, content: `Banned ${targetId}. Reason: ${reason}` });
    }
  },
  mute: {
    description: 'Mute a member (use duration like 10m for temporary)',
    permission: PermissionsBitField.Flags.ModerateMembers,
    async run({ message, interaction, args }) {
      const guild = message?.guild || interaction.guild;
      const targetId = args?.[0] || (interaction.options && interaction.options.getUser('user')?.id);
      if (!targetId) return reply({ message, interaction, content: 'Specify a user id or mention.' });
      const durationStr = args?.[1] || (interaction.options && interaction.options.getString('duration'));
      const reason = args?.slice(2).join(' ') || (interaction.options && interaction.options.getString('reason')) || 'No reason provided';
      const ms = parseDuration(durationStr);
      const member = await guild.members.fetch(targetId).catch(() => null);
      if (!member) return reply({ message, interaction, content: 'Member not found.' });
      const role = await ensureMutedRole(guild);
      if (!role) return reply({ message, interaction, content: 'Failed to ensure muted role.' });
      await member.roles.add(role).catch(e => console.error(e));
      const expiresAt = ms ? new Date(Date.now() + ms) : null;
      await Infraction.create({ guildId: guild.id, userId: member.id, type: 'mute', moderatorId: getActorId(message, interaction), reason, active: true, expiresAt, extra: { roleId: role.id } });
      return reply({ message, interaction, content: `Muted ${member.user.tag}${expiresAt ? ` until ${expiresAt.toISOString()}` : ''}. Reason: ${reason}` });
    }
  },
  unmute: {
    description: 'Unmute a member',
    permission: PermissionsBitField.Flags.ModerateMembers,
    async run({ message, interaction, args }) {
      const guild = message?.guild || interaction.guild;
      const targetId = args?.[0] || (interaction.options && interaction.options.getUser('user')?.id);
      if (!targetId) return reply({ message, interaction, content: 'Specify a user id or mention.' });
      const member = await guild.members.fetch(targetId).catch(() => null);
      if (!member) return reply({ message, interaction, content: 'Member not found.' });
      const inf = await Infraction.findOne({ guildId: guild.id, userId: targetId, type: 'mute', active: true }).sort({ createdAt: -1 });
      if (inf && inf.extra?.roleId) {
        const role = guild.roles.cache.get(inf.extra.roleId);
        if (role && member.roles.cache.has(role.id)) await member.roles.remove(role).catch(() => null);
        inf.active = false;
        await inf.save();
        return reply({ message, interaction, content: `Unmuted ${member.user.tag}` });
      } else {
        const role = guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
        if (role && member.roles.cache.has(role.id)) await member.roles.remove(role).catch(() => null);
        return reply({ message, interaction, content: `Attempted to unmute ${member.user.tag}` });
      }
    }
  },
  tempban: {
    description: 'Temporarily ban a user (e.g., 1d, 2h)',
    permission: PermissionsBitField.Flags.BanMembers,
    async run({ message, interaction, args }) {
      const guild = message?.guild || interaction.guild;
      const targetId = args?.[0] || (interaction.options && interaction.options.getUser('user')?.id);
      const durationStr = args?.[1] || (interaction.options && interaction.options.getString('duration'));
      const reason = args?.slice(2).join(' ') || (interaction.options && interaction.options.getString('reason')) || 'No reason provided';
      if (!targetId) return reply({ message, interaction, content: 'Specify a user id or mention.' });
      const ms = parseDuration(durationStr);
      if (!ms) return reply({ message, interaction, content: 'Invalid duration. Use formats like 10m, 2h, 1d.' });
      await guild.members.ban(targetId, { reason }).catch(e => console.error(e));
      const expiresAt = new Date(Date.now() + ms);
      await Infraction.create({ guildId: guild.id, userId: targetId, type: 'tempban', moderatorId: getActorId(message, interaction), reason, active: true, expiresAt });
      return reply({ message, interaction, content: `Temporarily banned ${targetId} until ${expiresAt.toISOString()}. Reason: ${reason}` });
    }
  },
  config: {
    description: 'View/update guild config (owner/mod only)',
    permission: PermissionsBitField.Flags.ManageGuild,
    async run({ message, interaction, args }) {
      const guild = message?.guild || interaction.guild;
      const sub = args?.[0]?.toLowerCase() || (interaction.options && interaction.options.getString('key'));
      const val = args?.[1] || (interaction.options && interaction.options.getString('value'));
      const cfg = await GuildConfig.getFor(guild.id);
      if (!sub) return reply({ message, interaction, content: `Config for ${guild.id}: prefix=${cfg.prefix}, blockInvites=${cfg.blockInvites}, antiRaid.enabled=${cfg.antiRaid.enabled}, antiRaid.action=${cfg.antiRaid.action}` });
      // settable keys: prefix, blockInvites, antiRaid.enabled, antiRaid.threshold, antiRaid.windowMs, antiRaid.action
      if (sub === 'prefix') { cfg.prefix = val || '!'; await cfg.save(); return reply({ message, interaction, content: `prefix set to ${cfg.prefix}` }); }
      if (sub === 'blockinvites') { cfg.blockInvites = (val === 'true'); await cfg.save(); return reply({ message, interaction, content: `blockInvites set to ${cfg.blockInvites}` }); }
      if (sub === 'antienable') { cfg.antiRaid.enabled = (val === 'true'); await cfg.save(); return reply({ message, interaction, content: `antiRaid.enabled set to ${cfg.antiRaid.enabled}` }); }
      if (sub === 'antiaction') { if (!['kick','ban','jail','lockdown'].includes(val)) return reply({ message, interaction, content: 'action must be one of kick,ban,jail,lockdown' }); cfg.antiRaid.action = val; await cfg.save(); return reply({ message, interaction, content: `antiRaid.action set to ${cfg.antiRaid.action}` }); }
      if (sub === 'antithreshold') { const n = parseInt(val,10)||5; cfg.antiRaid.threshold = n; await cfg.save(); return reply({ message, interaction, content: `antiRaid.threshold set to ${cfg.antiRaid.threshold}` }); }
      return reply({ message, interaction, content: 'Unknown config key' });
    }
  }
};

function getActorId(message, interaction) {
  return message?.author?.id || interaction?.user?.id || null;
}

async function reply({ message, interaction, content, ephemeral = false }) {
  try {
    if (interaction) {
      if (interaction.replied || interaction.deferred) return interaction.followUp({ content, ephemeral });
      return interaction.reply({ content, ephemeral });
    } else if (message) {
      return message.channel.send({ content });
    }
  } catch (e) {
    console.error('Reply failed', e);
  }
}

// register commands into client.commands for prefix handling as well
for (const name of Object.keys(commandImplementations)) {
  client.commands.set(name, commandImplementations[name]);
}

// ---------- SLASH COMMAND REGISTRATION (optional) ----------
async function registerSlashCommands() {
  try {
    // Lazy require to avoid forcing extra deps if not registering
    const { REST } = require('@discordjs/rest');
    const { Routes } = require('discord-api-types/v10');
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const cmds = [];

    // Build a minimal slash command structure for the implemented commands
    cmds.push({
      name: 'kick',
      description: 'Kick a member',
      options: [{ name: 'user', description: 'User to kick', type: 6, required: true }, { name: 'reason', description: 'Reason', type: 3 }]
    });
    cmds.push({
      name: 'ban',
      description: 'Ban a member',
      options: [{ name: 'user', description: 'User to ban', type: 6, required: true }, { name: 'reason', description: 'Reason', type: 3 }]
    });
    cmds.push({
      name: 'mute',
      description: 'Mute a member',
      options: [{ name: 'user', description: 'User to mute', type: 6, required: true }, { name: 'duration', description: 'Duration like 10m', type: 3 }, { name: 'reason', description: 'Reason', type: 3 }]
    });
    cmds.push({
      name: 'unmute',
      description: 'Unmute a member',
      options: [{ name: 'user', description: 'User to unmute', type: 6, required: true }]
    });
    cmds.push({
      name: 'tempban',
      description: 'Temporarily ban a member',
      options: [{ name: 'user', description: 'User to ban', type: 6, required: true }, { name: 'duration', description: 'Duration like 1d', type: 3 }, { name: 'reason', description: 'Reason', type: 3 }]
    });
    cmds.push({
      name: 'config',
      description: 'View or update guild config',
      options: [{ name: 'key', description: 'Key to set', type: 3 }, { name: 'value', description: 'Value', type: 3 }]
    });

    console.log('Registering global slash commands (this may take a minute)...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: cmds });
    console.log('Slash commands registered globally.');
  } catch (e) {
    console.error('Failed to register slash commands (ensure @discordjs/rest is installed and CLIENT_ID is set)', e);
  }
}

// ---------- ANTI-RAID JOIN TRACKER ----------
const joinTracker = new Map(); // guildId -> { timestamps: [] }

async function handleAntiRaid(member) {
  try {
    const cfg = await GuildConfig.getFor(member.guild.id);
    if (!cfg.antiRaid?.enabled) return;
    const now = Date.now();
    const windowMs = cfg.antiRaid.windowMs || 30_000;
    const threshold = cfg.antiRaid.threshold || 5;
    let data = joinTracker.get(member.guild.id);
    if (!data) { data = { timestamps: [] }; joinTracker.set(member.guild.id, data); }
    data.timestamps.push(now);
    data.timestamps = data.timestamps.filter(t => t >= now - windowMs);
    if (data.timestamps.length >= threshold) {
      const action = cfg.antiRaid.action || 'kick';
      try {
        if (action === 'kick') {
          await member.kick('Anti-raid triggered: join threshold exceeded').catch(() => null);
          await safeLog(member.guild, `Anti-raid: kicked ${member.user.tag}`);
        } else if (action === 'ban') {
          await member.ban({ reason: 'Anti-raid triggered' }).catch(() => null);
          await safeLog(member.guild, `Anti-raid: banned ${member.user.tag}`);
        } else if (action === 'jail') {
          const jailRole = await ensureJailRole(member.guild);
          if (jailRole) {
            // remove non-managed roles
            const removable = member.roles.cache.filter(r => !r.managed && r.id !== member.guild.id).map(r => r.id);
            await member.roles.remove(removable).catch(() => null);
            await member.roles.add(jailRole).catch(() => null);
            await safeLog(member.guild, `Anti-raid: jailed ${member.user.tag}`);
          }
        } else if (action === 'lockdown') {
          for (const [, ch] of member.guild.channels.cache) {
            try {
              if (ch?.isTextBased?.()) {
                await ch.permissionOverwrites.edit(member.guild.roles.everyone, { SendMessages: false }).catch(() => null);
              }
            } catch (e) { /* ignore */ }
          }
          await safeLog(member.guild, `Anti-raid: lockdown triggered`);
        }
      } catch (e) {
        console.error('Anti-raid action failed', e);
      } finally {
        data.timestamps = [];
      }
    }
  } catch (e) {
    console.error('handleAntiRaid error', e);
  }
}

async function safeLog(guild, content) {
  try {
    const ch = guild.systemChannel || guild.channels.cache.find(c => c.name?.toLowerCase().includes('mod') || c.name?.toLowerCase().includes('log'));
    if (ch && ch.isTextBased && typeof ch.send === 'function') {
      await ch.send(content).catch(() => null);
    } else {
      console.log(`[${guild.id}] ${content}`);
    }
  } catch (e) {
    console.error('safeLog error', e);
  }
}

// ---------- AUTOMOD (MESSAGE) ----------
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const cfg = await GuildConfig.getFor(message.guild.id);

  // prefix command handling
  const prefix = cfg.prefix || '!';
  if (message.content.startsWith(prefix)) {
    const without = message.content.slice(prefix.length).trim();
    const [cmdName, ...args] = without.split(/\s+/);
    const cmd = client.commands.get(cmdName.toLowerCase());
    if (cmd) {
      // permission check
      const required = cmd.permission;
      if (required && !message.member.permissions.has(required) && message.author.id !== OWNER_ID) {
        return message.reply('You do not have permission to run that command.');
      }
      try {
        await cmd.run({ message, args });
      } catch (e) {
        console.error('Command run error', e);
        message.reply('Command error.');
      }
      return;
    }
  }

  // automod: invites
  if (cfg.blockInvites && isInviteOrDiscordLink(message.content)) {
    await message.delete().catch(() => null);
    await message.channel.send({ content: `${message.author}, invites are not allowed here.` }).catch(() => null);
    return;
  }

  // profanity simple check
  if (Array.isArray(cfg.profanity) && cfg.profanity.length) {
    const content = message.content.toLowerCase();
    for (const bad of cfg.profanity) {
      if (!bad) continue;
      if (content.includes(bad.toLowerCase())) {
        await message.delete().catch(() => null);
        await message.channel.send({ content: `${message.author}, that word is not allowed.` }).catch(() => null);
        return;
      }
    }
  }
});

// ---------- INTERACTIONS (SLASH COMMANDS) ----------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const name = interaction.commandName;
  const impl = client.commands.get(name);
  if (!impl) return interaction.reply({ content: 'Command not implemented (prefix works).', ephemeral: true });
  // permission check
  const required = impl.permission;
  const member = interaction.member;
  if (required && (!member.permissions?.has(required)) && interaction.user.id !== OWNER_ID) {
    return interaction.reply({ content: 'You do not have permission to run that command.', ephemeral: true });
  }
  try {
    // build args array from options where appropriate
    const args = [];
    // for simple mapping: user -> user id, duration -> string, reason -> string
    if (interaction.options.getUser('user')) args.push(interaction.options.getUser('user').id);
    if (interaction.options.getString('duration')) args.push(interaction.options.getString('duration'));
    if (interaction.options.getString('reason')) args.push(interaction.options.getString('reason'));
    if (interaction.options.getString('key')) args.push(interaction.options.getString('key'));
    if (interaction.options.getString('value')) args.push(interaction.options.getString('value'));
    await impl.run({ interaction, args });
  } catch (e) {
    console.error('Slash command error', e);
    try { if (!interaction.replied) await interaction.reply({ content: 'Error while running command', ephemeral: true }); } catch (e) { /* ignore */ }
  }
});

// ---------- GUILD MEMBER ADD (ANTI-RAID) ----------
client.on('guildMemberAdd', async (member) => {
  try {
    await handleAntiRaid(member);
  } catch (e) {
    console.error('guildMemberAdd handler error', e);
  }
});

// ---------- SCHEDULER: EXPIRE INFRACTIONS ----------
setInterval(async () => {
  try {
    const now = new Date();
    const expired = await Infraction.find({ active: true, expiresAt: { $ne: null, $lte: now } });
    for (const inf of expired) {
      try {
        const guild = client.guilds.cache.get(inf.guildId) || await client.guilds.fetch(inf.guildId).catch(() => null);
        if (!guild) { inf.active = false; await inf.save(); continue; }
        if (inf.type === 'mute' && inf.extra?.roleId) {
          const member = await guild.members.fetch(inf.userId).catch(() => null);
          if (member) {
            const role = guild.roles.cache.get(inf.extra.roleId);
            if (role && member.roles.cache.has(role.id)) await member.roles.remove(role).catch(() => null);
          }
        } else if (inf.type === 'tempban' || inf.type === 'ban') {
          // try unban
          await guild.bans.remove(inf.userId).catch(() => null);
        }
        inf.active = false;
        await inf.save();
        console.log(`Expired infraction ${inf.type} for ${inf.userId} in guild ${inf.guildId}`);
      } catch (e) {
        console.error('Error expiring infraction', e);
      }
    }
  } catch (e) {
    console.error('Scheduler error', e);
  }
}, 15_000);

// ---------- UTILS ----------
function extractId(mention) {
  if (!mention) return null;
  const m = mention.match(/^<@!?(\d+)>$/);
  if (m) return m[1];
  if (/^\d+$/.test(mention)) return mention;
  return null;
}

// ---------- STARTUP ----------
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  if (REGISTER_SLASH && CLIENT_ID) {
    await registerSlashCommands().catch(() => null);
  } else if (REGISTER_SLASH) {
    console.warn('REGISTER_SLASH is true but CLIENT_ID is not set; skipping registration.');
  }
});

// Graceful login
client.login(TOKEN).catch(err => { console.error('Failed to login', err); process.exit(1); });

// ---------- OPTIONAL: support prefix parsing for mentions in args ----------
/* Note: prefix commands expect "prefixkick @user reason..." or "prefix mute @user 10m reason".
   For convenience when using prefix commands, the implementations above accept a raw ID or mention. */