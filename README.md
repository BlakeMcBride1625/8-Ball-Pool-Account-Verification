# Discord AccountChecker Bot

A production-ready TypeScript Discord bot that automatically verifies 8 Ball Pool ranks from screenshots using OCR, assigns Discord roles, and stores verification data in PostgreSQL.

## Features

- **Automatic Rank Verification**: Uses OCR (Tesseract.js) to extract rank and level information from uploaded screenshots
- **Role Management**: Automatically assigns the correct Discord role based on verified rank
- **Database Integration**: Stores all verification data in PostgreSQL using Prisma ORM
- **Slash Commands**: Full support for Discord slash commands (in addition to prefix commands)
- **Admin Commands**: Full suite of admin commands for managing verifications
- **Moderator Commands**: Commands for checking and listing verified users
- **DM Auto-Deletion**: Automatically deletes DM messages after 30 minutes
- **Profile Screenshot Validation**: Validates that uploaded images are profile screenshots, not main menu or other screens
- **Verification Channel Instructions**: Automatic welcome message with example image in the verification channel
- **Comprehensive Logging**: Logs all actions to both file and database
- **Error Handling**: Robust error handling with user-friendly DM notifications

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL database
- Discord Bot Token
- Discord Server with proper permissions

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd 8BPAccountChecker
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` and fill in your configuration:
```env
DISCORD_TOKEN=your_discord_bot_token_here
RANK_CHANNEL_ID=your_verification_channel_id
DATABASE_URL=postgresql://user:password@localhost:5432/accountchecker?schema=public
LOG_PATH=./logs/assignments.log
ADMIN_IDS=your_admin_user_id,another_admin_id
MODERATOR_IDS=your_moderator_id,another_moderator_id
COMMAND_PREFIX=!
GUILD_ID=your_guild_id_optional_for_faster_slash_command_registration
EXAMPLE_IMAGE_URL=https://example.com/path/to/example-profile-screenshot.png
```

4. Set up the database:
```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate
```

5. Build the project:
```bash
npm run build
```

6. Start the bot:
```bash
npm start
```

For development:
```bash
npm run dev
```

## Configuration

### Environment Variables

- `DISCORD_TOKEN` (required): Your Discord bot token
- `RANK_CHANNEL_ID` (required): Channel ID where users upload screenshots
- `DATABASE_URL` (required): PostgreSQL connection string
- `LOG_PATH` (optional): Path to log file (default: ./logs/assignments.log)
- `ADMIN_IDS` (required): Comma-separated list of Discord user IDs with admin permissions
- `MODERATOR_IDS` (optional): Comma-separated list of Discord user IDs with moderator permissions
- `COMMAND_PREFIX` (optional): Command prefix for prefix commands (default: !)
- `GUILD_ID` (optional): Guild ID for faster slash command registration (if not set, uses first available guild)
- `EXAMPLE_IMAGE_URL` (optional): URL to an example profile screenshot for the verification channel instructions embed

### Rank Configuration

Ranks are configured in `src/config/ranks.json`. Each rank includes:
- `role_id`: Discord role ID
- `rank_name`: Name of the rank
- `level_min`: Minimum level for this rank
- `level_max`: Maximum level for this rank

## Usage

### User Verification

1. Users upload a screenshot of their 8 Ball Pool profile to the configured verification channel
2. The bot validates that the image is a profile screenshot (not main menu or other screens)
3. The bot processes the image using OCR to extract rank and level from the "Level Progress" area
4. Rank and level are detected and matched using fuzzy matching
5. The appropriate Discord role is assigned (replaces any existing rank role)
6. Verification data is stored in the database
7. The screenshot is deleted from the channel
8. User receives a DM confirmation with embedded message including:
   - Verification confirmation
   - Link to 8BP Rewards registration website
   - Information about linking Discord account
9. The DM message is automatically deleted after 30 minutes

### Commands

The bot supports both **prefix commands** (using `!` by default) and **slash commands** (using `/`).

#### Admin Commands

**Prefix:** `!command` | **Slash:** `/command`

- `recheck <@user>` - Re-process user's latest verification
- `setrank <@user> <rank>` - Manually set a user's rank (slash command has autocomplete for rank names)
- `removerank <@user>` - Remove a user's rank and verification
- `purgedb` - Purge all verification records (requires confirmation)
- `logs [lines]` - View recent bot logs (default: 50 lines)
- `instructions` - Resend verification channel instructions message

#### Moderator Commands

**Prefix:** `!command` | **Slash:** `/command`

- `checkrank <@user>` - Check a user's verification record
- `listverified [page]` - List verified users with pagination (default: page 1)
- `help` - Show available commands (public command)

## Bot Permissions

The bot requires the following Discord permissions:
- View Channels
- Send Messages
- Manage Roles
- Manage Messages (to delete processed screenshots)
- Read Message History
- Attach Files (for embeds)
- Use Slash Commands (for slash command support)

**Important:** When inviting the bot, make sure to include the `applications.commands` scope in the invite URL. This is required for slash commands to work.

## Project Structure

```
8BPAccountChecker/
├── src/
│   ├── bot.ts                 # Main bot entry point
│   ├── commands/              # Command handlers
│   │   ├── admin.ts          # Admin commands
│   │   ├── moderator.ts      # Moderator commands
│   │   ├── slashCommands.ts  # Slash command registration and handlers
│   │   └── index.ts          # Command router
│   ├── services/             # Core services
│   │   ├── ocr.ts            # OCR service
│   │   ├── rankMatcher.ts    # Rank detection logic
│   │   ├── roleManager.ts    # Role management
│   │   ├── database.ts       # Database operations
│   │   ├── logger.ts         # Logging service
│   │   └── dmCleanup.ts      # DM message cleanup service
│   ├── types/                # TypeScript types
│   ├── config/               # Configuration files
│   │   └── ranks.json        # Rank configuration
│   └── events/               # Event handlers
│       └── messageCreate.ts  # Message and image processing
├── assets/
│   └── images/               # Example profile screenshots (optional)
├── prisma/                   # Prisma schema and migrations
├── logs/                     # Log files
└── dist/                     # Compiled JavaScript
```

## Troubleshooting

### Bot not responding to commands
- Check that the bot has proper permissions in the server
- Verify that `ADMIN_IDS` and `MODERATOR_IDS` are set correctly
- Check the command prefix in `.env` (for prefix commands)
- For slash commands: Ensure the bot was invited with `applications.commands` scope
- Slash commands may take up to 1 hour to appear globally, or set `GUILD_ID` for immediate availability

### Slash commands not appearing
- Verify the bot was invited with the `applications.commands` scope
- Check bot logs for command registration success messages
- Set `GUILD_ID` in `.env` for faster guild-specific registration
- Wait up to 1 hour for global command propagation
- Try restarting Discord client

### OCR not working
- Ensure images are clear and readable
- Check that images are in supported formats (.jpg, .jpeg, .png)
- Verify Tesseract.js is properly installed

### Database connection errors
- Verify `DATABASE_URL` is correct
- Ensure PostgreSQL is running
- Check database permissions

### Role assignment failures
- Verify the bot has "Manage Roles" permission
- Ensure the bot's role is above the rank roles in the role hierarchy
- Check that role IDs in `ranks.json` are correct

### DM messages not being deleted
- DM auto-deletion happens after 30 minutes
- Check bot logs for any deletion errors
- Ensure the bot has permission to delete its own messages

### Profile screenshot validation failing
- Ensure users upload actual profile screenshots (not main menu or other screens)
- The bot looks for specific indicators like "Profile", "Rank:", "Level progress", etc.
- Check logs for validation details

## Development

### Building
```bash
npm run build
```

### Running in development
```bash
npm run dev
```

### Database migrations
```bash
npm run prisma:migrate
```

### Prisma Studio (database GUI)
```bash
npm run prisma:studio
```

## License

ISC

## Additional Features

### Example Profile Screenshot

You can add an example profile screenshot to display in the verification channel instructions:

1. Place your example image in `assets/images/` as one of:
   - `example-profile.png`
   - `example-profile.jpg`
   - `example-profile.jpeg`

2. Alternatively, set `EXAMPLE_IMAGE_URL` in `.env` to use a URL

The bot will automatically detect and use the local file if available, otherwise falls back to the URL.

### DM Auto-Deletion

All DM messages sent by the bot are automatically deleted after 30 minutes to keep user DMs clean. This includes:
- Verification confirmation messages
- Error messages
- All other bot DMs

### Duplicate Prevention

The bot automatically checks for existing instruction messages in the verification channel on startup to prevent duplicates.

## Support

For issues and questions, please open an issue on the repository.

