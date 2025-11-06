import { Message, EmbedBuilder } from 'discord.js';
import { databaseService } from '../services/database';
import { isAdmin, isModerator } from './index';

/**
 * Handle moderator commands
 */
export async function handleModeratorCommand(
  message: Message,
  command: string,
  args: string[],
  extractUserIdFn: (arg: string) => string | null
): Promise<boolean> {
  switch (command) {
    case 'checkrank':
      return await handleCheckRank(message, args, extractUserIdFn);
    case 'listverified':
      return await handleListVerified(message, args);
    case 'help':
      return await handleHelp(message);
    default:
      return false;
  }
}

/**
 * !checkrank <@user> - Check user's verification record
 */
async function handleCheckRank(
  message: Message,
  args: string[],
  extractUserIdFn: (arg: string) => string | null
): Promise<boolean> {
  if (args.length < 1) {
    await message.reply('Usage: `!checkrank <@user>`');
    return true;
  }

  const userId = extractUserIdFn(args[0]);
  if (!userId) {
    await message.reply('Invalid user. Please mention a user or provide a user ID.');
    return true;
  }

  try {
    const verification = await databaseService.getVerification(userId);
    
    if (!verification) {
      await message.reply('User has no verification record.');
      return true;
    }

    const embed = new EmbedBuilder()
      .setTitle('Verification Record')
      .addFields(
        { name: 'User', value: `<@${verification.discord_id}>`, inline: true },
        { name: 'Username', value: verification.username, inline: true },
        { name: 'Rank', value: verification.rank_name, inline: true },
        { name: 'Level', value: verification.level_detected.toString(), inline: true },
        { name: 'Role ID', value: verification.role_id_assigned, inline: true },
        { name: 'Verified At', value: verification.verified_at.toLocaleString(), inline: false },
        { name: 'Updated At', value: verification.updated_at.toLocaleString(), inline: false }
      )
      .setColor(0x00AE86)
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    return true;
  } catch (error) {
    await message.reply('An error occurred while checking the user.');
    return true;
  }
}

/**
 * !listverified [limit] - List recent verified users
 */
async function handleListVerified(message: Message, args: string[]): Promise<boolean> {
  const limit = args.length > 0 ? parseInt(args[0], 10) : 10;
  
  if (isNaN(limit) || limit < 1 || limit > 50) {
    await message.reply('Invalid limit. Please provide a number between 1 and 50.');
    return true;
  }

  try {
    const verifications = await databaseService.getRecentVerifications(limit);

    if (verifications.length === 0) {
      await message.reply('No verified users found.');
      return true;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Recent Verified Users (${verifications.length})`)
      .setColor(0x00AE86)
      .setTimestamp();

    const fields = verifications.map((v, index) => ({
      name: `${index + 1}. ${v.username}`,
      value: `Rank: **${v.rank_name}** (Level ${v.level_detected})\nVerified: ${v.verified_at.toLocaleDateString()}`,
      inline: false,
    }));

    // Discord embeds have a limit of 25 fields
    const displayFields = fields.slice(0, 25);
    embed.addFields(displayFields);

    if (fields.length > 25) {
      embed.setFooter({ text: `Showing 25 of ${fields.length} results` });
    }

    await message.reply({ embeds: [embed] });
    return true;
  } catch (error) {
    await message.reply('An error occurred while fetching verified users.');
    return true;
  }
}

/**
 * !help - Show available commands
 */
async function handleHelp(message: Message): Promise<boolean> {
  const isUserAdmin = isAdmin(message.author.id);
  const isUserModerator = isModerator(message.author.id);

  const embed = new EmbedBuilder()
    .setTitle('AccountChecker Bot Commands')
    .setColor(0x00AE86)
    .setTimestamp();

  if (isUserAdmin) {
    embed.addFields({
      name: 'Admin Commands',
      value: [
        '`!recheck <@user>` - Re-process user\'s latest verification',
        '`!setrank <@user> <rank>` - Manually set a user\'s rank',
        '`!removerank <@user>` - Remove a user\'s rank and verification',
        '`!purgedb` - Purge all verification records (requires confirmation)',
        '`!logs` - Get the path to the log file',
        '`!instructions` - Resend verification channel instructions',
      ].join('\n'),
      inline: false,
    });
  }

  if (isUserModerator) {
    embed.addFields({
      name: 'Moderator Commands',
      value: [
        '`!checkrank <@user>` - Check a user\'s verification record',
        '`!listverified [limit]` - List recent verified users (default: 10, max: 50)',
        '`!help` - Show this help message',
      ].join('\n'),
      inline: false,
    });
  }

  if (!isUserModerator) {
    embed.setDescription('You do not have permission to use any commands. Contact an administrator for access.');
  }

  await message.reply({ embeds: [embed] });
  return true;
}

