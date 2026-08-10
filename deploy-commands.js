require('dotenv').config();

const { REST, Routes } = require('discord.js');

const commands = [
    require('./commands/ping').data.toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('🔄 Registering slash commands...');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );

        console.log('✅ Slash commands registered!');
    } catch (error) {
        console.error(error);
    }
})();
