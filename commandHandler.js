const fs = require('fs');
const path = require('path');

function loadCommands(client) {
    const commandsPath = path.join(__dirname, 'commands');

    if (!fs.existsSync(commandsPath)) {
        console.log('⚠️ Commands folder not found.');
        return;
    }

    const commandFolders = fs.readdirSync(commandsPath);

    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);

        if (!fs.statSync(folderPath).isDirectory()) continue;

        const commandFiles = fs
            .readdirSync(folderPath)
            .filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = path.join(folderPath, file);
            const command = require(filePath);

            if (!command.data || !command.execute) {
                console.log(`⚠️ ${file} is missing command data or execute function.`);
                continue;
            }

            client.commands.set(command.data.name, command);
        }
    }

    console.log(`✅ Loaded ${client.commands.size} command(s).`);
}

module.exports = { loadCommands };
