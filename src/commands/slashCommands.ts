import { 
  ChatInputCommandInteraction, 
  AutocompleteInteraction,
  SlashCommandBuilder, 
  REST, 
  Routes,
  PermissionFlagsBits 
} from 'discord.js';
import { handleAdminCommand } from './admin';
import { handleModeratorCommand } from './moderator';
import { logger } from '../services/logger';
import { isAdmin, isModerator, extractUserId } from './index';
import { rankMatcher } from '../services/rankMatcher';

/**
 * Register slash commands with Discord
 */
export async function registerSlashCommands(clientId: string, token: string, guildId?: string): Promise<void> {
  const commands = [
    // Admin commands
    new SlashCommandBuilder()
      .setName('recheck')
      .setDescription('Re-process a user\'s latest verification')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to recheck')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    new SlashCommandBuilder()
      .setName('setrank')
      .setDescription('Manually set a user\'s rank')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to set rank for')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('rank')
          .setDescription('The rank name to assign')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    new SlashCommandBuilder()
      .setName('removerank')
      .setDescription('Remove a user\'s verified rank')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to remove rank from')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    new SlashCommandBuilder()
      .setName('purgedb')
      .setDescription('Purge all verification records from the database')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    new SlashCommandBuilder()
      .setName('logs')
      .setDescription('View recent bot logs')
      .addIntegerOption(option =>
        option.setName('lines')
          .setDescription('Number of log lines to retrieve (default: 50)')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    new SlashCommandBuilder()
      .setName('instructions')
      .setDescription('Resend verification channel instructions')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    // Moderator commands
    new SlashCommandBuilder()
      .setName('checkrank')
      .setDescription('Check a user\'s verified rank')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to check')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    new SlashCommandBuilder()
      .setName('listverified')
      .setDescription('List all verified users')
      .addIntegerOption(option =>
        option.setName('page')
          .setDescription('Page number (default: 1)')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show available commands'),
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    logger.info('Started refreshing application (/) commands.');

    if (guildId) {
      // Register guild-specific commands (faster, for testing)
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      logger.info(`Successfully reloaded ${commands.length} application (/) commands for guild ${guildId}.`);
    } else {
      // Register global commands (takes up to 1 hour to propagate)
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      logger.info(`Successfully reloaded ${commands.length} application (/) commands globally.`);
    }
  } catch (error) {
    logger.error('Error registering slash commands', { error });
    throw error;
  }
}

/**
 * Handle autocomplete interaction
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  
  if (focusedOption.name === 'rank') {
    const allRanks = rankMatcher.getAllRanks();
    const query = focusedOption.value.toLowerCase();
    
    // Filter ranks that match the query
    const filtered = allRanks
      .filter(rank => rank.rank_name.toLowerCase().includes(query))
      .slice(0, 25) // Discord limit is 25 choices
      .map(rank => ({
        name: rank.rank_name,
        value: rank.rank_name,
      }));
    
    await interaction.respond(filtered);
  }
}

/**
 * Handle slash command interaction
 */
export async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  const commandName = interaction.commandName;
  const userId = interaction.user.id;

  // Check permissions
  const isUserAdmin = isAdmin(userId);
  const isUserModerator = isModerator(userId);

  // Defer reply to give us time to process
  await interaction.deferReply({ ephemeral: true });

  try {
    // Admin commands
    if (isUserAdmin) {
      switch (commandName) {
        case 'recheck': {
          const user = interaction.options.getUser('user', true);
          // Convert to message-like format for existing handlers
          let replied = false;
          const mockMessage = {
            author: { id: userId },
            guild: interaction.guild,
            channel: interaction.channel,
            reply: async (content: any) => {
              replied = true;
              if (typeof content === 'string') {
                await interaction.editReply({ content });
              } else if (content.embeds) {
                await interaction.editReply({ embeds: content.embeds, files: content.files });
              } else {
                await interaction.editReply({ content: String(content) });
              }
            },
          } as any;
          
          await handleAdminCommand(mockMessage, 'recheck', [user.id], extractUserId);
          if (!replied) {
            await interaction.editReply({ content: '✅ Recheck completed.' });
          }
          return;
        }

        case 'setrank': {
          const user = interaction.options.getUser('user', true);
          const rank = interaction.options.getString('rank', true);
          let replied = false;
          const mockMessage = {
            author: { id: userId },
            guild: interaction.guild,
            channel: interaction.channel,
            reply: async (content: any) => {
              replied = true;
              if (typeof content === 'string') {
                await interaction.editReply({ content });
              } else if (content.embeds) {
                await interaction.editReply({ embeds: content.embeds, files: content.files });
              } else {
                await interaction.editReply({ content: String(content) });
              }
            },
          } as any;
          
          await handleAdminCommand(mockMessage, 'setrank', [user.id, rank], extractUserId);
          if (!replied) {
            await interaction.editReply({ content: '✅ Rank set successfully.' });
          }
          return;
        }

        case 'removerank': {
          const user = interaction.options.getUser('user', true);
          let replied = false;
          const mockMessage = {
            author: { id: userId },
            guild: interaction.guild,
            channel: interaction.channel,
            reply: async (content: any) => {
              replied = true;
              if (typeof content === 'string') {
                await interaction.editReply({ content });
              } else if (content.embeds) {
                await interaction.editReply({ embeds: content.embeds, files: content.files });
              } else {
                await interaction.editReply({ content: String(content) });
              }
            },
          } as any;
          
          await handleAdminCommand(mockMessage, 'removerank', [user.id], extractUserId);
          if (!replied) {
            await interaction.editReply({ content: '✅ Rank removed successfully.' });
          }
          return;
        }

        case 'purgedb': {
          let replied = false;
          const mockMessage = {
            author: { id: userId },
            guild: interaction.guild,
            channel: interaction.channel,
            reply: async (content: any) => {
              replied = true;
              if (typeof content === 'string') {
                await interaction.editReply({ content });
              } else if (content.embeds) {
                await interaction.editReply({ embeds: content.embeds, files: content.files });
              } else {
                await interaction.editReply({ content: String(content) });
              }
            },
          } as any;
          
          await handleAdminCommand(mockMessage, 'purgedb', [], extractUserId);
          if (!replied) {
            await interaction.editReply({ content: '✅ Database purged.' });
          }
          return;
        }

        case 'logs': {
          const lines = interaction.options.getInteger('lines') || 50;
          let replied = false;
          const mockMessage = {
            author: { id: userId },
            guild: interaction.guild,
            channel: interaction.channel,
            reply: async (content: any) => {
              replied = true;
              if (typeof content === 'string') {
                await interaction.editReply({ content });
              } else if (content.embeds) {
                await interaction.editReply({ embeds: content.embeds, files: content.files });
              } else {
                await interaction.editReply({ content: String(content) });
              }
            },
          } as any;
          
          await handleAdminCommand(mockMessage, 'logs', [lines.toString()], extractUserId);
          if (!replied) {
            await interaction.editReply({ content: '✅ Logs retrieved.' });
          }
          return;
        }

        case 'instructions': {
          let replied = false;
          const mockMessage = {
            author: { id: userId },
            guild: interaction.guild,
            channel: interaction.channel,
            reply: async (content: any) => {
              replied = true;
              if (typeof content === 'string') {
                await interaction.editReply({ content });
              } else if (content.embeds) {
                await interaction.editReply({ embeds: content.embeds, files: content.files });
              } else {
                await interaction.editReply({ content: String(content) });
              }
            },
          } as any;
          
          await handleAdminCommand(mockMessage, 'instructions', [], extractUserId);
          if (!replied) {
            await interaction.editReply({ content: '✅ Instructions sent.' });
          }
          return;
        }
      }
    }

    // Moderator commands (includes admins)
    if (isUserModerator) {
      switch (commandName) {
        case 'checkrank': {
          const user = interaction.options.getUser('user', true);
          let replied = false;
          const mockMessage = {
            author: { id: userId },
            guild: interaction.guild,
            channel: interaction.channel,
            reply: async (content: any) => {
              replied = true;
              if (typeof content === 'string') {
                await interaction.editReply({ content });
              } else if (content.embeds) {
                await interaction.editReply({ embeds: content.embeds, files: content.files });
              } else {
                await interaction.editReply({ content: String(content) });
              }
            },
          } as any;
          
          await handleModeratorCommand(mockMessage, 'checkrank', [user.id], extractUserId);
          if (!replied) {
            await interaction.editReply({ content: '✅ Rank checked.' });
          }
          return;
        }

        case 'listverified': {
          const page = interaction.options.getInteger('page') || 1;
          let replied = false;
          const mockMessage = {
            author: { id: userId },
            guild: interaction.guild,
            channel: interaction.channel,
            reply: async (content: any) => {
              replied = true;
              if (typeof content === 'string') {
                await interaction.editReply({ content });
              } else if (content.embeds) {
                await interaction.editReply({ embeds: content.embeds, files: content.files });
              } else {
                await interaction.editReply({ content: String(content) });
              }
            },
          } as any;
          
          await handleModeratorCommand(mockMessage, 'listverified', [page.toString()], extractUserId);
          if (!replied) {
            await interaction.editReply({ content: '✅ Verified users listed.' });
          }
          return;
        }
      }
    }

    // Public commands
    if (commandName === 'help') {
      let replied = false;
      const mockMessage = {
        author: { id: userId },
        guild: interaction.guild,
        channel: interaction.channel,
        reply: async (content: any) => {
          replied = true;
          if (typeof content === 'string') {
            await interaction.editReply({ content });
          } else if (content.embeds) {
            await interaction.editReply({ embeds: content.embeds, files: content.files });
          } else {
            await interaction.editReply({ content: String(content) });
          }
        },
      } as any;
      
      await handleModeratorCommand(mockMessage, 'help', [], extractUserId);
      if (!replied) {
        await interaction.editReply({ content: '✅ Help displayed.' });
      }
      return;
    }

    // Unknown command or insufficient permissions
    await interaction.editReply({ 
      content: '❌ You do not have permission to use this command or the command does not exist.'
    });
  } catch (error) {
    logger.error('Error handling slash command', { error, command: commandName, user_id: userId });
    try {
      await interaction.editReply({ 
        content: '❌ An error occurred while processing your command.'
      });
    } catch (editError) {
      // If edit fails, try to reply (shouldn't happen but just in case)
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          content: '❌ An error occurred while processing your command.', 
          ephemeral: true 
        });
      }
    }
  }
}

