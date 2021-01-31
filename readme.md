# Twitch Live Notifications for Discord
This script notifies a Discord channel (using Discord webhooks) when streamers of your choice go live. Streamer names are stored in an sqlite db.

## Installation
I host this on [repl.it](https://repl.it/), but anywhere that supports NodeJS should work.
1. Create an app at https://dev.twitch.tv/console/apps/create (you can leave OAuth Redirect URLs blank)
1. Copy the Client ID and Client Secret somewhere safe for use in a later step
1. Log in to repl.it
1. New Project > Import from GitHub
1. Paste the Repo URL & click "Import from GitHub"
1. Change .env.sample to .env
    * TWITCH_CLIENT_ID = the client ID of your Twitch Application
    * TWITCH_SECRET = the client secret of your Twitch Application
    * DISCORD_WEBHOOK_URL = Go to your discord channel > Channel Settings > Integrations > Create a webhook and paste its url here
    * HUB_SECRET = Not used currently, but will be implemented later for additional security
    * REPL_URL = The URL of your Repl.it project (otherwise this should be the path to your node app)
    * PASSCODE = A password for yourself, so random people can't add or remove users from your watch list.
1. Run the Repl app

## Usage
* **[Your Repl URL]/a/[Your Passcode]/[Twitch Username]** Adds a user to the watch list *(e.g. https://twitch.amazing.repl.co/a/pa55word/brofar)*
* **[Your Repl URL]/d/[Your Passcode]/[Twitch Username]** Removes a user from the watch list *(e.g. https://twitch.amazing.repl.co/d/pa55word/brofar)*