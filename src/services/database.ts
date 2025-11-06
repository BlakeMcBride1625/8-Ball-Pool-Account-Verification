import { PrismaClient, Verification } from '@prisma/client';
import { VerificationData, LogEntry } from '../types';
import { logger } from './logger';

class DatabaseService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient({
      log: ['error', 'warn'],
    });

    // Set up database logger callback for logger service
    logger.setDatabaseLogger(this.logToDatabase.bind(this));
  }

  /**
   * Log entry to database (for logger service callback)
   */
  private async logToDatabase(_entry: LogEntry): Promise<void> {
    // For now, we'll just log to the file. If you want to store logs in a separate table,
    // you can create a Log model in Prisma schema and store them here.
    // This is a placeholder for future database logging if needed.
  }

  /**
   * Upsert verification record (create or update)
   */
  async upsertVerification(data: VerificationData): Promise<Verification> {
    try {
      const verification = await this.prisma.verification.upsert({
        where: {
          discord_id: data.discord_id,
        },
        update: {
          username: data.username,
          rank_name: data.rank_name,
          level_detected: data.level_detected,
          role_id_assigned: data.role_id_assigned,
          updated_at: new Date(),
        },
        create: {
          discord_id: data.discord_id,
          username: data.username,
          rank_name: data.rank_name,
          level_detected: data.level_detected,
          role_id_assigned: data.role_id_assigned,
        },
      });

      logger.info('Verification upserted', { discord_id: data.discord_id, rank_name: data.rank_name });
      return verification;
    } catch (error) {
      logger.error('Failed to upsert verification', { error, data });
      throw error;
    }
  }

  /**
   * Get verification record by Discord ID
   */
  async getVerification(discordId: string): Promise<Verification | null> {
    try {
      const verification = await this.prisma.verification.findUnique({
        where: {
          discord_id: discordId,
        },
      });

      return verification;
    } catch (error) {
      logger.error('Failed to get verification', { error, discordId });
      throw error;
    }
  }

  /**
   * Delete verification record
   */
  async deleteVerification(discordId: string): Promise<void> {
    try {
      await this.prisma.verification.delete({
        where: {
          discord_id: discordId,
        },
      });

      logger.info('Verification deleted', { discord_id: discordId });
    } catch (error) {
      logger.error('Failed to delete verification', { error, discordId });
      throw error;
    }
  }

  /**
   * Get recent verifications
   */
  async getRecentVerifications(limit: number = 10): Promise<Verification[]> {
    try {
      const verifications = await this.prisma.verification.findMany({
        take: limit,
        orderBy: {
          verified_at: 'desc',
        },
      });

      return verifications;
    } catch (error) {
      logger.error('Failed to get recent verifications', { error, limit });
      throw error;
    }
  }

  /**
   * Purge all verification records (admin only)
   */
  async purgeAllVerifications(): Promise<number> {
    try {
      const result = await this.prisma.verification.deleteMany({});
      logger.warn('All verifications purged', { count: result.count });
      return result.count;
    } catch (error) {
      logger.error('Failed to purge verifications', { error });
      throw error;
    }
  }

  /**
   * Get Prisma client (for advanced queries if needed)
   */
  getClient(): PrismaClient {
    return this.prisma;
  }

  /**
   * Disconnect from database
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
    logger.info('Database disconnected');
  }
}

export const databaseService = new DatabaseService();

