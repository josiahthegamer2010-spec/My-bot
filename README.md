# Mod Bot

A Discord bot with:
- 👋 **Welcome messages** — greets new members in a channel you choose
- 🔒 **/lock** and 🔓 **/unlock** — stop/allow @everyone from sending messages in a channel
- 👢 **/kick** — kick a member
- 🔨 **/ban** — ban a member (with optional message history deletion)

## 1. Create the bot in Discord

1. Go to https://discord.com/developers/applications → **New Application**.
2. Go to the **Bot** tab → **Reset Token** → copy it (this is your `DISCORD_TOKEN`, keep it secret).
3. On the same Bot tab, enable these under **Privileged Gateway Intents**:
   - `SERVER MEMBERS INTENT` (required for welcome messages, kick, ban)
4. Go to **OAuth2 → General** and copy the **Client ID** (this is your `CLIENT_ID`).
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Kick Members`, `Ban Members`, `Manage Channels`, `Send Messages`, `Embed Links`, `View Channel`
   - Copy the generated URL, open it in your browser, and invite the bot to your server.

## 2. Get your server (guild) ID and welcome channel ID

- In Discord, enable Developer Mode: **User Settings → Advanced → Developer Mode**.
- Right-click your server icon → **Copy Server ID** → this is `GUILD_ID`.
- Right-click the channel you want welcome messages posted in → **Copy Channel ID** → this is `WELCOME_CHANNEL_ID`.

## 3. Configure the project

```bash
cp .env.example .env
```

Open `.env` and fill in:
```
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-application-client-id
GUILD_ID=your-server-id
WELCOME_CHANNEL_ID=your-welcome-channel-id
```

## 4. Install and run

```bash
npm install
npm run deploy   # registers the /lock, /unlock, /kick, /ban slash commands
npm start        # starts the bot
```

If everything worked, your console will print `Logged in as YourBotName#1234`.

## Commands

| Command | Permission required | What it does |
|---|---|---|
| `/lock [channel] [reason]` | Manage Channels | Blocks @everyone from sending messages in the channel (current channel if none given) |
| `/unlock [channel]` | Manage Channels | Restores @everyone's ability to send messages |
| `/kick <user> [reason]` | Kick Members | Kicks the member from the server |
| `/ban <user> [reason] [delete_days]` | Ban Members | Bans the member, optionally deleting 0–7 days of their message history |

Slash commands are only usable by members who already hold the listed Discord permission — Discord enforces this automatically, so random members can't run `/kick` or `/ban` even if they can see the command.

## Notes

- Commands are deployed to a single server (`GUILD_ID`) for instant availability. To make them global (usable if you add the bot to multiple servers), edit `deploy-commands.js` to use `Routes.applicationCommands(CLIENT_ID)` instead — global commands take up to an hour to show up.
- Keep your `.env` file (and especially `DISCORD_TOKEN`) private — never commit it or share it. Anyone with your token can control your bot.
- The bot's own role must sit **above** any role you want it to kick/ban/manage, in Server Settings → Roles.
