import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { LogEntry } from '../types';

class LoggerService {
  private logger: winston.Logger;
  private logPath: string;
  private databaseLogger?: (entry: LogEntry) => Promise<void>;

  constructor() {
    this.logPath = process.env.LOG_PATH || './logs/assignments.log';
    
    // Ensure log directory exists
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Create Winston logger
    this.logger = winston.createLogger({
      level: 'debug',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({
          filename: this.logPath,
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),
      ],
    });
  }

  setDatabaseLogger(logger: (entry: LogEntry) => Promise<void>) {
    this.databaseLogger = logger;
  }

  private async logToDatabase(entry: LogEntry): Promise<void> {
    if (this.databaseLogger) {
      try {
        await this.databaseLogger(entry);
      } catch (error) {
        this.logger.error('Failed to log to database', { error });
      }
    }
  }

  async logAction(entry: LogEntry): Promise<void> {
    // Log to file
    const logMessage = {
      timestamp: entry.timestamp.toISOString(),
      action_type: entry.action_type,
      user_id: entry.user_id,
      username: entry.username,
      rank_name: entry.rank_name,
      level_detected: entry.level_detected,
      role_id_assigned: entry.role_id_assigned,
      success: entry.success,
      error_message: entry.error_message,
      command_name: entry.command_name,
    };

    if (entry.success) {
      this.logger.info(JSON.stringify(logMessage));
    } else {
      this.logger.error(JSON.stringify(logMessage));
    }

    // Log to database
    await this.logToDatabase(entry);
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  error(message: string, meta?: any): void {
    this.logger.error(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  getLogPath(): string {
    return this.logPath;
  }
}

export const logger = new LoggerService();

