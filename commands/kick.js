const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .addUserOption((option) =>
      option.setName('user').setDescription('The member to kick').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Reason for the kick').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: 'That user is not in this server.', ephemeral: true });
    }

    if (!member.kickable) {
      return interaction.reply({
        content: "I can't kick that member (check role hierarchy / my permissions).",
        ephemeral: true,
      });
    }

    if (member.id === interaction.user.id) {
      return interaction.reply({ content: "You can't kick yourself.", ephemeral: true });
    }

    await member.kick(reason);

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Member Kicked')
      .addFields(
        { name: 'User', value: `${target.tag} (${target.id})` },
        { name: 'Moderator', value: `${interaction.user.tag}` },
        { name: 'Reason', value: reason }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
