const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock a channel so @everyone cannot send messages')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to lock (defaults to this channel)')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Reason for locking').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const everyoneRole = interaction.guild.roles.everyone;

    await channel.permissionOverwrites.edit(
      everyoneRole,
      { SendMessages: false },
      { reason: `Locked by ${interaction.user.tag}: ${reason}` }
    );

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('🔒 Channel Locked')
      .setDescription(`${channel} has been locked.`)
      .addFields(
        { name: 'Moderator', value: `${interaction.user.tag}` },
        { name: 'Reason', value: reason }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
