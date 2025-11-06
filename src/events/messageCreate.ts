import { Message, Attachment, EmbedBuilder } from 'discord.js';
import { ocrService } from '../services/ocr';
import { rankMatcher } from '../services/rankMatcher';
import { roleManager } from '../services/roleManager';
import { databaseService } from '../services/database';
import { logger } from '../services/logger';
import { dmCleanupService } from '../services/dmCleanup';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const RANK_CHANNEL_ID = process.env.RANK_CHANNEL_ID || '1436026328913547377';
const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const TEMP_DIR = path.join(process.cwd(), 'tmp');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Download image from URL to temporary file
 */
async function downloadImage(url: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(filePath);

    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });

      file.on('error', (err) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Send DM to user with verification confirmation
 */
async function sendVerificationDM(userId: string, rankName: string, levelMin: number): Promise<void> {
  try {
    const client = (global as any).client;
    if (!client) {
      logger.warn('Discord client not available for DM', { user_id: userId });
      return;
    }
    const user = await client.users.fetch(userId);
    if (!user) {
      logger.warn('User not found for DM', { user_id: userId });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Rank Verification Successful')
      .setDescription(
        `Your 8 Ball Pool rank has been verified as **${rankName}** (Level ${levelMin}+).\n\n` +
        `Your Discord role has been updated successfully.\n\n` +
        `\u200B`
      )
      .addFields(
        {
          name: '🎁 Auto-Claim Rewards',
          value: `Why not Register in are Automatic rewards claiming Process for free if you arent already click the link below\n\n\n` +
                 `**8BP Rewards Registration:**\n\n` +
                 `https://8ballpool.website/8bp-rewards/home`,
          inline: false,
        },
        {
          name: '\u200B',
          value: '\u200B',
          inline: false,
        },
        {
          name: '\u200B',
          value: '\u200B',
          inline: false,
        },
        {
          name: '🔗 Link Your Account',
          value: `If you would like to link your Discord to your 8 Ball Pool Unique ID, you can use the slash command:\n\n\n` +
                 `\`/link-account\``,
          inline: false,
        }
      )
      .setColor(0x00AE86)
      .setTimestamp();

    const sentMessage = await user.send({ embeds: [embed] });
    logger.info('Verification DM sent', { user_id: userId, rank_name: rankName });
    
    // Schedule message for deletion after 30 minutes
    if (sentMessage) {
      dmCleanupService.scheduleDeletion(sentMessage);
    }
  } catch (error) {
    // User may have DMs disabled
    logger.warn('Failed to send verification DM', { error, user_id: userId });
  }
}

/**
 * Send error DM to user
 */
async function sendErrorDM(userId: string, message: string): Promise<void> {
  try {
    const client = (global as any).client;
    if (!client) {
      return;
    }
    const user = await client.users.fetch(userId);
    if (!user) {
      return;
    }

    const sentMessage = await user.send(message);
    
    // Schedule message for deletion after 30 minutes
    if (sentMessage) {
      dmCleanupService.scheduleDeletion(sentMessage);
    }
  } catch (error) {
    // User may have DMs disabled - that's okay for error messages
    logger.debug('Failed to send error DM', { error, user_id: userId });
  }
}

/**
 * Validate if image is a profile screenshot
 */
function isValidProfileScreenshot(ocrText: string): boolean {
  // Must have at least one of these profile indicators
  const profileIndicators = [
    /profile/i,  // "Profile" text
    /rank\s*[:\-]?\s*[a-z\s]+/i,  // "Rank: X" pattern
    /(?:level|evel|lvl)\s*progress/i,  // "Level progress" pattern
    /unique\s*id/i,  // "Unique ID" text
    /player\s*stats/i,  // "Player Stats" text
  ];
  
  // Should NOT have main menu indicators
  const mainMenuIndicators = [
    /8\s*ball\s*pool\s*by\s*miniclip/i,  // Main menu logo
    /play\s*special/i,  // Play buttons
    /play\s*minigames/i,
    /play\s*with\s*friends/i,
    /pool\s*pass/i,  // Pool Pass banner
    /free\s*rewards/i,  // Free Rewards button
    /leaderboards/i,  // Leaderboards button
    /shop/i,  // Shop button (in context of main menu)
    /clubs/i,  // Clubs button
    /one\s*&\s*done/i,  // Event banners
    /event\s*hyperspace/i,
    /brainrot\s*shop/i,
  ];
  
  // Check for main menu indicators first - if found, it's NOT a profile
  for (const pattern of mainMenuIndicators) {
    if (pattern.test(ocrText)) {
      logger.debug('Main menu indicator found, not a profile screenshot', { pattern: pattern.toString() });
      return false;
    }
  }
  
  // Check for profile indicators - must have at least one
  let hasProfileIndicator = false;
  for (const pattern of profileIndicators) {
    if (pattern.test(ocrText)) {
      hasProfileIndicator = true;
      logger.debug('Profile indicator found', { pattern: pattern.toString() });
      break;
    }
  }
  
  if (!hasProfileIndicator) {
    logger.debug('No profile indicators found in OCR text');
    return false;
  }
  
  return true;
}

/**
 * Process a single image attachment
 */
async function processImage(attachment: Attachment): Promise<{ success: boolean; rank?: any; level?: number; isProfile?: boolean }> {
  // Extract file extension, handling URLs with query parameters
  const urlWithoutQuery = attachment.url.split('?')[0];
  const fileExtension = path.extname(urlWithoutQuery).toLowerCase();
  
  // Also check content type as fallback
  const contentType = attachment.contentType || '';
  const isImage = ALLOWED_IMAGE_EXTENSIONS.includes(fileExtension) || contentType.startsWith('image/');
  
  if (!isImage) {
    logger.debug('Attachment is not an image', { 
      extension: fileExtension, 
      content_type: contentType,
      url: attachment.url 
    });
    return { success: false };
  }

  const tempFilePath = path.join(TEMP_DIR, `image_${Date.now()}_${Math.random().toString(36).substring(7)}${fileExtension}`);

  try {
    logger.info('Starting image processing', { url: attachment.url, temp_path: tempFilePath });
    
    // Download image
    logger.debug('Downloading image...');
    await downloadImage(attachment.url, tempFilePath);
    logger.debug('Image downloaded successfully');

    // Extract text using OCR
    logger.debug('Starting OCR extraction...');
    const ocrResult = await ocrService.extractText(tempFilePath);
    logger.info('OCR extraction completed', { 
      text_length: ocrResult.text.length, 
      confidence: ocrResult.confidence,
      text_preview: ocrResult.text.substring(0, 200)
    });

    // Validate that this is a profile screenshot
    const isProfile = isValidProfileScreenshot(ocrResult.text);
    if (!isProfile) {
      logger.warn('Image is not a profile screenshot', { 
        ocr_text_preview: ocrResult.text.substring(0, 300) 
      });
      return { success: false, isProfile: false };
    }

    // Match rank
    logger.debug('Starting rank matching...');
    const matchedRank = rankMatcher.matchRank(ocrResult.text);
    
    if (!matchedRank) {
      logger.warn('No rank matched from OCR text', { 
        ocr_text_preview: ocrResult.text.substring(0, 300) 
      });
      return { success: false, isProfile: true };
    }

    logger.info('Rank matched successfully', { 
      rank_name: matchedRank.rank_name, 
      level: matchedRank.level_detected,
      confidence: matchedRank.confidence
    });

    return {
      success: true,
      rank: matchedRank,
      level: matchedRank.level_detected,
    };
  } catch (error) {
    logger.error('Error processing image', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      attachment_url: attachment.url 
    });
    return { success: false };
  } finally {
    // Clean up temporary file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

/**
 * Handle message create event
 */
export async function handleMessageCreate(message: Message): Promise<void> {
  // Ignore bot messages
  if (message.author.bot) {
    return;
  }

  // Debug: Log all messages in the rank channel
  if (message.channel.id === RANK_CHANNEL_ID) {
    logger.debug('Message received in rank channel', {
      channel_id: message.channel.id,
      user_id: message.author.id,
      username: message.author.username,
      has_attachments: message.attachments.size > 0,
      attachment_count: message.attachments.size,
    });
  }

  // Only process messages in the rank verification channel
  if (message.channel.id !== RANK_CHANNEL_ID) {
    return;
  }

  // Only process messages with image attachments
  const imageAttachments = message.attachments.filter(attachment => {
    const ext = path.extname(attachment.url).toLowerCase();
    const contentType = attachment.contentType || '';
    const isImage = ALLOWED_IMAGE_EXTENSIONS.includes(ext) || contentType.startsWith('image/');
    
    logger.debug('Checking attachment', {
      url: attachment.url,
      extension: ext,
      content_type: contentType,
      is_image: isImage,
      filename: attachment.name,
    });
    
    return isImage;
  });

  logger.debug('Image attachment filter result', {
    total_attachments: message.attachments.size,
    image_attachments: imageAttachments.size,
  });

  if (imageAttachments.size === 0) {
    logger.debug('No image attachments found, skipping message');
    return;
  }

  logger.info('Processing image(s) from user', {
    user_id: message.author.id,
    username: message.author.username,
    attachment_count: imageAttachments.size,
  });

  // Process all images and find the best match
  const results: Array<{ success: boolean; rank?: any; level?: number; confidence?: number; isProfile?: boolean }> = [];

  for (const attachment of imageAttachments.values()) {
    const result = await processImage(attachment);
    if (result.success && result.rank) {
      results.push({
        success: true,
        rank: result.rank,
        level: result.level,
        confidence: result.rank.confidence,
        isProfile: result.isProfile,
      });
    } else if (result.isProfile === false) {
      // Image was processed but is not a profile screenshot
      results.push({
        success: false,
        isProfile: false,
      });
    }
  }

  // Check if any images were invalid (not profile screenshots)
  const invalidImages = results.filter(r => r.isProfile === false);
  if (invalidImages.length > 0) {
    await sendErrorDM(
      message.author.id,
      "❌ Invalid format. Please upload a screenshot of your 8 Ball Pool **Profile** screen (showing your level, rank, and stats), not the main menu or other screens."
    );

    await logger.logAction({
      timestamp: new Date(),
      action_type: 'ocr_processed',
      user_id: message.author.id,
      username: message.author.username,
      success: false,
      error_message: 'Invalid image format - not a profile screenshot',
    });

    // Delete the message
    try {
      await message.delete();
    } catch (error) {
      logger.warn('Failed to delete message after invalid format', { error });
    }

    return;
  }

  // If no successful matches, send error DM
  if (results.length === 0 || !results.some(r => r.success && r.rank)) {
    await sendErrorDM(
      message.author.id,
      "I couldn't read your screenshot clearly. Please upload a clearer image of your 8 Ball Pool profile showing your level and rank."
    );

    await logger.logAction({
      timestamp: new Date(),
      action_type: 'ocr_processed',
      user_id: message.author.id,
      username: message.author.username,
      success: false,
      error_message: 'OCR failed to extract rank information',
    });

    // Delete the message
    try {
      await message.delete();
    } catch (error) {
      logger.warn('Failed to delete message after OCR failure', { error });
    }

    return;
  }

  // Find the best match (highest confidence)
  const bestMatch = results.reduce((best, current) => {
    if (!best || (current.confidence && current.confidence > (best.confidence || 0))) {
      return current;
    }
    return best;
  });

  if (!bestMatch.rank) {
    return;
  }

  const matchedRank = bestMatch.rank;
  const levelDetected = bestMatch.level || matchedRank.level_min;

  try {
    // Get guild member
    const member = await message.guild?.members.fetch(message.author.id);
    if (!member) {
      logger.error('Member not found in guild', { user_id: message.author.id, guild_id: message.guild?.id });
      return;
    }

    // Check if user already has a higher rank
    const existingVerification = await databaseService.getVerification(message.author.id);
    if (existingVerification) {
      const existingRank = rankMatcher.getRankByName(existingVerification.rank_name);
      if (existingRank && existingRank.level_min > matchedRank.level_min) {
        // User already has a higher rank, ignore this verification
        logger.info('User already has higher rank, ignoring', {
          user_id: message.author.id,
          existing_rank: existingVerification.rank_name,
          new_rank: matchedRank.rank_name,
        });

        // Delete the message
        try {
          await message.delete();
        } catch (error) {
          logger.warn('Failed to delete message', { error });
        }

        return;
      }
    }

    // Assign role
    await roleManager.assignRankRole(member, {
      role_id: matchedRank.role_id,
      rank_name: matchedRank.rank_name,
      level_min: matchedRank.level_min,
      level_max: matchedRank.level_max,
    });

    // Update database
    await databaseService.upsertVerification({
      discord_id: message.author.id,
      username: message.author.username,
      rank_name: matchedRank.rank_name,
      level_detected: levelDetected,
      role_id_assigned: matchedRank.role_id,
    });

    // Log action
    await logger.logAction({
      timestamp: new Date(),
      action_type: 'verification_updated',
      user_id: message.author.id,
      username: message.author.username,
      rank_name: matchedRank.rank_name,
      level_detected: levelDetected,
      role_id_assigned: matchedRank.role_id,
      success: true,
    });

    // Send DM confirmation
    await sendVerificationDM(message.author.id, matchedRank.rank_name, matchedRank.level_min);

    // Delete the processed screenshot
    try {
      await message.delete();
      logger.info('Message deleted after successful processing', { message_id: message.id });
    } catch (error) {
      logger.warn('Failed to delete message after processing', { error, message_id: message.id });
    }
  } catch (error) {
    logger.error('Error in verification process', {
      error,
      user_id: message.author.id,
      username: message.author.username,
      rank_name: matchedRank.rank_name,
    });

    // Send error DM to user
    await sendErrorDM(
      message.author.id,
      "An error occurred while processing your verification. Please try again or contact an administrator."
    );

    // Log error
    await logger.logAction({
      timestamp: new Date(),
      action_type: 'error',
      user_id: message.author.id,
      username: message.author.username,
      success: false,
      error_message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

