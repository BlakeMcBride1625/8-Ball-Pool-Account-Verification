import { createWorker } from 'tesseract.js';
import { OCRResult } from '../types';
import { logger } from './logger';

class OCRService {
  private worker: any = null;
  private initialized: boolean = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.worker = await createWorker('eng');
      this.initialized = true;
      logger.info('OCR service initialized');
    } catch (error) {
      logger.error('Failed to initialize OCR service', { error });
      throw error;
    }
  }

  async extractText(imagePath: string): Promise<OCRResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(`Processing image: ${imagePath}`);
      
      const { data } = await this.worker.recognize(imagePath, {
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ',
      });

      const text = data.text.trim();
      const confidence = data.confidence || 0;

      logger.info(`OCR extracted text (confidence: ${confidence}): ${text.substring(0, 500)}`);

      return {
        text,
        confidence,
      };
    } catch (error) {
      logger.error('OCR extraction failed', { error, imagePath });
      throw new Error(`Failed to extract text from image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async extractTextFromBuffer(imageBuffer: Buffer): Promise<OCRResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug('Processing image from buffer');
      
      const { data } = await this.worker.recognize(imageBuffer, {
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ',
      });

      const text = data.text.trim();
      const confidence = data.confidence || 0;

      logger.info(`OCR extracted text from buffer (confidence: ${confidence}): ${text.substring(0, 500)}`);

      return {
        text,
        confidence,
      };
    } catch (error) {
      logger.error('OCR extraction from buffer failed', { error });
      throw new Error(`Failed to extract text from image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
      logger.info('OCR service terminated');
    }
  }
}

export const ocrService = new OCRService();

