import { Message, DMChannel, User } from 'discord.js';
import { logger } from './logger';

interface ScheduledDeletion {
  messageId: string;
  channelId: string;
  deleteAt: number;
  timeout: NodeJS.Timeout;
}

class DMCleanupService {
  private scheduledDeletions: Map<string, ScheduledDeletion> = new Map();
  private readonly DELETE_AFTER_MS = 30 * 60 * 1000; // 30 minutes

  /**
   * Schedule a DM message for deletion after 30 minutes
   */
  scheduleDeletion(message: Message): void {
    if (!message.channel.isDMBased()) {
      return; // Only schedule DMs
    }

    const messageId = message.id;
    const channelId = message.channel.id;
    const deleteAt = Date.now() + this.DELETE_AFTER_MS;

    // Cancel existing deletion if any
    this.cancelDeletion(messageId);

    const timeout = setTimeout(async () => {
      try {
        await message.delete();
        logger.info('Scheduled DM message deleted', {
          message_id: messageId,
          channel_id: channelId,
        });
        this.scheduledDeletions.delete(messageId);
      } catch (error) {
        logger.warn('Failed to delete scheduled DM message', {
          error,
          message_id: messageId,
          channel_id: channelId,
        });
        this.scheduledDeletions.delete(messageId);
      }
    }, this.DELETE_AFTER_MS);

    this.scheduledDeletions.set(messageId, {
      messageId,
      channelId,
      deleteAt,
      timeout,
    });

    logger.debug('DM message scheduled for deletion', {
      message_id: messageId,
      channel_id: channelId,
      delete_at: new Date(deleteAt).toISOString(),
    });
  }

  /**
   * Cancel a scheduled deletion
   */
  cancelDeletion(messageId: string): void {
    const scheduled = this.scheduledDeletions.get(messageId);
    if (scheduled) {
      clearTimeout(scheduled.timeout);
      this.scheduledDeletions.delete(messageId);
    }
  }

  /**
   * Delete all existing DM messages from the bot to all users
   * Note: This only works for DM channels that are in cache or that we can access
   * Discord.js doesn't provide a way to list all DM channels
   */
  async deleteAllBotDMs(): Promise<void> {
    try {
      const client = (global as any).client;
      if (!client || !client.user) {
        logger.warn('Client not available for DM cleanup');
        return;
      }

      logger.info('Starting cleanup of all bot DM messages...');
      let deletedCount = 0;
      let errorCount = 0;
      let channelsChecked = 0;

      // Get all DM channels from cache
      const dmChannels = client.channels.cache.filter(
        (channel: any) => channel.isDMBased()
      ) as Map<string, DMChannel>;

      channelsChecked = dmChannels.size;

      // Also try to get DM channels from users we've interacted with
      // This is limited but better than nothing
      const users = client.users.cache.filter((user: User) => !user.bot);
      
      for (const [userId, user] of users) {
        try {
          // Try to get or create DM channel
          const dmChannel = await user.createDM();
          
          // Fetch messages from the DM channel
          const messages = await dmChannel.messages.fetch({ limit: 100 });
          
          // Filter for bot messages
          const botMessages = messages.filter(
            (msg: Message) => msg.author.id === client.user.id
          );

          // Delete each bot message
          for (const [messageId, message] of botMessages) {
            try {
              await message.delete();
              deletedCount++;
              logger.debug('Deleted bot DM message', {
                message_id: messageId,
                channel_id: dmChannel.id,
                user_id: userId,
              });
              // Small delay to avoid rate limits
              await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error: any) {
              // Ignore "Unknown Message" errors (message already deleted)
              if (error.code !== 10008) {
                errorCount++;
                logger.debug('Failed to delete bot DM message', {
                  error: error.message,
                  message_id: messageId,
                  channel_id: dmChannel.id,
                });
              }
            }
          }
        } catch (error: any) {
          // Ignore errors for users we can't DM (DMs disabled, etc.)
          if (error.code !== 50007) {
            logger.debug('Failed to access DM channel for user', {
              error: error.message,
              user_id: userId,
            });
          }
        }
      }

      // Also check cached DM channels
      for (const [channelId, channel] of dmChannels) {
        try {
          const messages = await channel.messages.fetch({ limit: 100 });
          const botMessages = messages.filter(
            (msg: Message) => msg.author.id === client.user.id
          );

          for (const [messageId, message] of botMessages) {
            try {
              await message.delete();
              deletedCount++;
              logger.debug('Deleted bot DM message from cached channel', {
                message_id: messageId,
                channel_id: channelId,
              });
              await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error: any) {
              if (error.code !== 10008) {
                errorCount++;
              }
            }
          }
        } catch (error) {
          logger.debug('Failed to fetch messages from cached DM channel', {
            error,
            channel_id: channelId,
          });
        }
      }

      logger.info('DM cleanup completed', {
        deleted_count: deletedCount,
        error_count: errorCount,
        channels_checked: channelsChecked,
        users_checked: users.size,
      });
    } catch (error) {
      logger.error('Error during DM cleanup', { error });
    }
  }

  /**
   * Cleanup scheduled deletions on shutdown
   */
  cleanup(): void {
    for (const [, scheduled] of this.scheduledDeletions) {
      clearTimeout(scheduled.timeout);
    }
    this.scheduledDeletions.clear();
    logger.info('DM cleanup service cleaned up');
  }
}

export const dmCleanupService = new DMCleanupService();

