# Discord Lockdown Bot

Slash-command bot for locking your server down fast during a raid or emergency,
and unlocking it again cleanly afterward.

## Commands

| Command | What it does |
|---|---|
| `/lockdown [reason]` | Locks **every** text channel — removes "Send Messages" for @everyone |
| `/unlock` | Restores exactly the permissions each channel had before lockdown |
| `/lockdown_channel [reason]` | Locks only the channel you run it in |

All three require **Administrator** permission to use.

## 1. Create the bot on Discord

1. Go to https://discord.com/developers/applications → **New Application**
2. Left sidebar → **Bot** → **Reset Token** → copy it (you'll only see it once)
3. Under **Privileged Gateway Intents**, enable **Server Members Intent**
4. Left sidebar → **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Manage Channels`, `Manage Roles`, `View Channels`, `Send Messages`
5. Copy the generated URL, open it, and invite the bot to your server

## 2. Run it locally (to test)

```bash
cd lockdown-bot
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env and paste your bot token in

python bot.py
```

Once it logs in, slash commands can take up to ~1 hour to appear globally the
first time (Discord's sync delay) — usually it's within a minute or two.

## 3. Keep it online every day (hosting)

Your own computer being on isn't reliable for this — you want it hosted
somewhere that stays up. A few solid free/cheap options:

### Option A — Railway.app (easiest, free tier)
1. Push this folder to a GitHub repo
2. https://railway.app → New Project → Deploy from GitHub repo
3. Add an environment variable `DISCORD_BOT_TOKEN` in the Railway dashboard
4. Railway auto-detects Python and runs `python bot.py` — it'll restart automatically if it crashes

### Option B — A VPS you already have / a Raspberry Pi (most control)
Use `systemd` so it survives reboots and restarts on crash:

```ini
# /etc/systemd/system/lockdown-bot.service
[Unit]
Description=Discord Lockdown Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/youruser/lockdown-bot
ExecStart=/home/youruser/lockdown-bot/venv/bin/python bot.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable lockdown-bot
sudo systemctl start lockdown-bot
sudo systemctl status lockdown-bot   # check it's running
```

### Option C — Replit / Pella / other Discord-bot-friendly hosts
Also work fine for a bot this size; just make sure whichever you pick keeps
the process alive without you needing to leave a browser tab open.

## Notes

- `lockdown_state.json` is created automatically — it remembers the exact
  permission state of each channel so `/unlock` restores things precisely
  rather than just guessing "allow everyone."
- If `/unlock` says "No lockdown is currently recorded," it means the bot's
  process restarted after `/lockdown` was run and lost its in-memory state —
  the JSON file protects against this as long as the file persists across
  restarts (it will, as long as you don't wipe the deploy).
- Never commit your real `.env` file or token to a public GitHub repo.
