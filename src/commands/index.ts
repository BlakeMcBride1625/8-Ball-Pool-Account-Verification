import { Message } from 'discord.js';
import { handleAdminCommand } from './admin';
import { handleModeratorCommand } from './moderator';
import { logger } from '../services/logger';

const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '!';
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
const MODERATOR_IDS = (process.env.MODERATOR_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

/**
 * Check if user is admin
 */
function isAdmin(userId: string): boolean {
  return ADMIN_IDS.includes(userId);
}

/**
 * Check if user is moderator (includes admins)
 */
function isModerator(userId: string): boolean {
  return isAdmin(userId) || MODERATOR_IDS.includes(userId);
}

/**
 * Parse command from message
 */
function parseCommand(message: Message): { command: string; args: string[] } | null {
  if (!message.content.startsWith(COMMAND_PREFIX)) {
    return null;
  }

  const parts = message.content.slice(COMMAND_PREFIX.length).trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  return { command, args };
}

/**
 * Extract user mention or ID from argument
 */
function extractUserId(arg: string): string | null {
  // Check for mention format: <@123456789> or <@!123456789>
  const mentionMatch = arg.match(/<@!?(\d+)>/);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  // Check if it's a plain user ID (numeric)
  if (/^\d+$/.test(arg)) {
    return arg;
  }

  return null;
}

/**
 * Handle command message
 */
export async function handleCommand(message: Message): Promise<void> {
  // Ignore bot messages
  if (message.author.bot) {
    return;
  }

  // Only process commands in guilds
  if (!message.guild) {
    return;
  }

  const parsed = parseCommand(message);
  if (!parsed) {
    return;
  }

  const { command, args } = parsed;

  // Admin commands
  if (isAdmin(message.author.id)) {
    const handled = await handleAdminCommand(message, command, args, extractUserId);
    if (handled) {
      await logger.logAction({
        timestamp: new Date(),
        action_type: 'command_executed',
        user_id: message.author.id,
        username: message.author.username,
        command_name: command,
        success: true,
      });
      return;
    }
  }

  // Moderator commands (includes admins)
  if (isModerator(message.author.id)) {
    const handled = await handleModeratorCommand(message, command, args, extractUserId);
    if (handled) {
      await logger.logAction({
        timestamp: new Date(),
        action_type: 'command_executed',
        user_id: message.author.id,
        username: message.author.username,
        command_name: command,
        success: true,
      });
      return;
    }
  }

  // Unknown command or insufficient permissions
  if (command === 'help' || command === 'commands') {
    // Show help even if not moderator
    await handleModeratorCommand(message, 'help', [], extractUserId);
  }
}

export { isAdmin, isModerator, extractUserId };

