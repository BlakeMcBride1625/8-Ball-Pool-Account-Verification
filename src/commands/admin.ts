import { Message, TextChannel, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import path from 'path';
import fs from 'fs';
import { databaseService } from '../services/database';
import { roleManager } from '../services/roleManager';
import { rankMatcher } from '../services/rankMatcher';
import { logger } from '../services/logger';

/**
 * Handle admin commands
 */
export async function handleAdminCommand(
  message: Message,
  command: string,
  args: string[],
  extractUserIdFn: (arg: string) => string | null
): Promise<boolean> {
  switch (command) {
    case 'recheck':
      return await handleRecheck(message, args, extractUserIdFn);
    case 'setrank':
      return await handleSetRank(message, args, extractUserIdFn);
    case 'removerank':
      return await handleRemoveRank(message, args, extractUserIdFn);
    case 'purgedb':
      return await handlePurgeDB(message);
    case 'logs':
      return await handleLogs(message);
    case 'instructions':
      return await handleInstructions(message);
    default:
      return false;
  }
}

/**
 * !recheck <@user> - Re-process user's latest verification
 */
async function handleRecheck(
  message: Message,
  args: string[],
  extractUserIdFn: (arg: string) => string | null
): Promise<boolean> {
  if (args.length < 1) {
    await message.reply('Usage: `!recheck <@user>`');
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

    await message.reply(`User ${args[0]} is currently verified as **${verification.rank_name}** (Level ${verification.level_detected}).\n\nNote: This command would re-process their latest verification image, but that functionality requires storing image URLs in the database. For now, please ask the user to upload a new screenshot.`);
    return true;
  } catch (error) {
    logger.error('Error in recheck command', { error });
    await message.reply('An error occurred while checking the user.');
    return true;
  }
}

/**
 * !setrank <@user> <rank> - Manually set rank
 */
async function handleSetRank(
  message: Message,
  args: string[],
  extractUserIdFn: (arg: string) => string | null
): Promise<boolean> {
  if (args.length < 2) {
    await message.reply('Usage: `!setrank <@user> <rank>`');
    return true;
  }

  const userId = extractUserIdFn(args[0]);
  if (!userId) {
    await message.reply('Invalid user. Please mention a user or provide a user ID.');
    return true;
  }

  const rankName = args.slice(1).join(' ');
  const rank = rankMatcher.getRankByName(rankName);

  if (!rank) {
    await message.reply(`Invalid rank name: "${rankName}". Please use a valid rank name.`);
    return true;
  }

  try {
    const member = await message.guild?.members.fetch(userId);
    if (!member) {
      await message.reply('User not found in this server.');
      return true;
    }

    // Assign role
    await roleManager.assignRankRole(member, rank);

    // Update database
    await databaseService.upsertVerification({
      discord_id: userId,
      username: member.user.username,
      rank_name: rank.rank_name,
      level_detected: rank.level_min,
      role_id_assigned: rank.role_id,
    });

    await logger.logAction({
      timestamp: new Date(),
      action_type: 'role_assigned',
      user_id: userId,
      username: member.user.username,
      rank_name: rank.rank_name,
      level_detected: rank.level_min,
      role_id_assigned: rank.role_id,
      success: true,
      command_name: 'setrank',
    });

    await message.reply(`✅ Successfully set ${args[0]}'s rank to **${rank.rank_name}**.`);
    return true;
  } catch (error) {
    logger.error('Error in setrank command', { error });
    await message.reply('An error occurred while setting the rank.');
    return true;
  }
}

/**
 * !removerank <@user> - Remove user's rank
 */
async function handleRemoveRank(
  message: Message,
  args: string[],
  extractUserIdFn: (arg: string) => string | null
): Promise<boolean> {
  if (args.length < 1) {
    await message.reply('Usage: `!removerank <@user>`');
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

    const member = await message.guild?.members.fetch(userId);
    if (member) {
      // Remove all rank roles
      await roleManager.removeAllRankRolesFromMember(member);
    }

    // Delete verification record
    await databaseService.deleteVerification(userId);

    await logger.logAction({
      timestamp: new Date(),
      action_type: 'command_executed',
      user_id: userId,
      username: verification.username,
      command_name: 'removerank',
      success: true,
    });

    await message.reply(`✅ Successfully removed ${args[0]}'s rank and verification record.`);
    return true;
  } catch (error) {
    logger.error('Error in removerank command', { error });
    await message.reply('An error occurred while removing the rank.');
    return true;
  }
}

/**
 * !purgedb - Purge all verification records
 */
async function handlePurgeDB(message: Message): Promise<boolean> {
  // Require confirmation
  await message.reply('⚠️ **WARNING**: This will delete ALL verification records. Type `!purgedb confirm` to confirm.');

  // Wait for confirmation (this is a simple implementation - in production you might want a better confirmation system)
  if (message.channel instanceof TextChannel) {
    const filter = (m: Message) => m.author.id === message.author.id && m.content.toLowerCase() === '!purgedb confirm';
    const collector = message.channel.createMessageCollector({ filter, time: 30000, max: 1 });

    collector.on('collect', async () => {
      try {
        const count = await databaseService.purgeAllVerifications();
        await message.reply(`✅ Successfully purged ${count} verification record(s).`);

        await logger.logAction({
          timestamp: new Date(),
          action_type: 'command_executed',
          user_id: message.author.id,
          username: message.author.username,
          command_name: 'purgedb',
          success: true,
        });
      } catch (error) {
        logger.error('Error in purgedb command', { error });
        await message.reply('An error occurred while purging the database.');
      }
    });

    collector.on('end', async (collected: any) => {
      if (collected.size === 0) {
        await message.reply('Purge cancelled (no confirmation received).');
      }
    });
  }

  return true;
}

/**
 * !logs - Get log file path
 */
async function handleLogs(message: Message): Promise<boolean> {
  const logPath = logger.getLogPath();
  await message.reply(`Log file location: \`${logPath}\``);
  return true;
}

/**
 * !instructions - Resend verification channel instructions
 */
async function handleInstructions(message: Message): Promise<boolean> {
  try {
    const channelId = process.env.RANK_CHANNEL_ID;
    if (!channelId) {
      await message.reply('RANK_CHANNEL_ID not configured.');
      return true;
    }

    const channel = await message.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await message.reply('Verification channel not found.');
      return true;
    }

    const exampleImageUrl = process.env.EXAMPLE_IMAGE_URL || '';
    const assetsDir = path.join(process.cwd(), 'assets', 'images');
    const exampleImagePaths = [
      path.join(assetsDir, 'example-profile.png'),
      path.join(assetsDir, 'example-profile.jpg'),
      path.join(assetsDir, 'example-profile.jpeg'),
    ];

    // Check for local example image file
    let exampleImagePath: string | null = null;
    for (const imgPath of exampleImagePaths) {
      if (fs.existsSync(imgPath)) {
        exampleImagePath = imgPath;
        break;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('📸 8 Ball Pool Rank Verification')
      .setDescription(
        '**Please add your profile here to receive your specific role!**\n\n' +
        '1. Click onto your **account profile** on 8 Ball Pool\n' +
        '2. Take a screenshot of your profile screen (showing your level, rank, and stats)\n' +
        '3. Upload the screenshot here\n' +
        '4. You will receive a DM confirming your verified rank and role assignment\n\n' +
        '**Important:**\n' +
        '• Only profile screenshots are accepted (not main menu or other screens)\n' +
        '• Make sure your screenshot clearly shows your **Level** and **Rank**\n' +
        '• The bot will automatically assign you the correct role based on your rank\n' +
        '• Your screenshot will be deleted after processing to keep the channel clean\n\n' +
        '**⚠️ Disclaimer:**\n' +
        '• If you misuse this system, you may be banned from the server\n' +
        '• If we detect that this is not your account (e.g., account dealing/trading), we may remove the account verification'
      )
      .setColor(0x00AE86)
      .setTimestamp();

    const attachments: AttachmentBuilder[] = [];

    // Use local file if available, otherwise use URL
    if (exampleImagePath) {
      const attachment = new AttachmentBuilder(exampleImagePath, { name: 'example-profile.png' });
      attachments.push(attachment);
      embed.setImage(`attachment://example-profile.png`);
      embed.setFooter({ text: 'Example profile screenshot above' });
    } else if (exampleImageUrl) {
      embed.setImage(exampleImageUrl);
      embed.setFooter({ text: 'Example profile screenshot above' });
    }

    if ('send' in channel) {
      await channel.send({ embeds: [embed], files: attachments });
      await message.reply('✅ Instructions sent to verification channel.');
    } else {
      await message.reply('Unable to send message to verification channel.');
    }
    return true;
  } catch (error) {
    logger.error('Error sending instructions', { error });
    await message.reply('An error occurred while sending instructions.');
    return true;
  }
}

