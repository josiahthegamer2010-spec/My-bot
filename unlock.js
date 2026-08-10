const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock a channel so @everyone can send messages again')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to unlock (defaults to this channel)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const everyoneRole = interaction.guild.roles.everyone;

    await channel.permissionOverwrites.edit(
      everyoneRole,
      { SendMessages: null }, // remove the override, restore default/inherited perms
      { reason: `Unlocked by ${interaction.user.tag}` }
    );

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('🔓 Channel Unlocked')
      .setDescription(`${channel} has been unlocked.`)
      .addFields({ name: 'Moderator', value: `${interaction.user.tag}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
