require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  EmbedBuilder,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,   // needed for welcome messages + kick/ban
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.GuildMember],
});

// ---- Load slash commands from /commands ----
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// ---- Ready ----
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ---- Welcome message on member join ----
client.on('guildMemberAdd', async (member) => {
  const channelId = process.env.WELCOME_CHANNEL_ID;
  if (!channelId) return;

  const channel = member.guild.channels.cache.get(channelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('Welcome!')
    .setDescription(`Hey ${member}, welcome to **${member.guild.name}**! We're glad you're here.`)
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: `Member #${member.guild.memberCount}` })
    .setTimestamp();

  channel.send({ embeds: [embed] }).catch((err) => {
    console.error('Failed to send welcome message:', err);
  });
});

// ---- Handle slash commands ----
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error executing /${interaction.commandName}:`, err);
    const errorReply = { content: 'Something went wrong running that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorReply);
    } else {
      await interaction.reply(errorReply);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
