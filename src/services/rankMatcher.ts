import { RankConfig, MatchedRank } from '../types';
import ranksConfig from '../config/ranks.json';
import { logger } from './logger';

class RankMatcherService {
  private ranks: RankConfig[];

  constructor() {
    this.ranks = ranksConfig as RankConfig[];
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Calculate similarity score between two strings (0-1, where 1 is identical)
   */
  private similarity(str1: string, str2: string): number {
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1;
    const distance = this.levenshteinDistance(str1, str2);
    return 1 - distance / maxLength;
  }

  /**
   * Normalize text by removing OCR noise and common misreads
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Extract level number from text - ONLY from Level Progress area
   * Ignores: Player Stats, VIP, Trophies, Username, Unique ID, Rings, Global Collection Power
   */
  private extractLevel(text: string): number | null {
    const foundLevels: Array<{ level: number; priority: number; context: string }> = [];

    // ONLY look in the Level Progress area - find the level progress section first
    // OCR might read it as "Level progress", "evel progre", "level progre", "evel progre bhi", etc.
    // Be flexible with OCR errors and truncation
    const levelProgressPattern = /(?:level|evel|lvl)\s*progre(?:ss|s|bhi|bh)?/i;
    let levelProgressMatch = text.match(levelProgressPattern);
    
    // If not found, try more flexible patterns
    if (!levelProgressMatch) {
      const altPatterns = [
        /(?:level|evel|lvl)\s*prog/i,
        /evel\s*progre/i,
        /level\s*progre/i,
      ];
      for (const pattern of altPatterns) {
        levelProgressMatch = text.match(pattern);
        if (levelProgressMatch) {
          logger.debug(`Found alternative level progress pattern: ${levelProgressMatch[0]}`);
          break;
        }
      }
    }

    // Priority 1: Numbers in Level Progress area (highest priority)
    // Look for patterns like "Level progress 618" or numbers near "level progress"
    let searchText = text;
    let levelProgressIndex = -1;
    
    if (levelProgressMatch && levelProgressMatch.index !== undefined) {
      levelProgressIndex = levelProgressMatch.index;
      // Extract text around level progress (next 200 characters should contain the level and rank)
      const startIndex = Math.max(0, levelProgressIndex);
      const endIndex = Math.min(text.length, levelProgressIndex + levelProgressMatch[0].length + 200);
      searchText = text.substring(startIndex, endIndex);
      logger.debug(`Found level progress area: ${searchText.substring(0, 150)}`);
    } else {
      logger.debug('Level progress pattern not found, will search full text (fallback)');
    }

    // Look for explicit "Level" patterns in the level progress area
    const explicitLevelPatterns = [
      /(?:level|evel|lvl)\s*progress\s*[:\-]?\s*(\d+)/i,
      /(?:level|evel|lvl)\s*[:\-]?\s*(\d+)/i,
    ];

    for (const pattern of explicitLevelPatterns) {
      const matches = searchText.matchAll(new RegExp(pattern, 'gi'));
      for (const match of matches) {
        const level = parseInt(match[1], 10);
        if (level >= 1 && level <= 9999) {
          foundLevels.push({ level, priority: 10, context: match[0] });
        }
      }
    }

    // Priority 2: Look for standalone numbers ONLY in the Level Progress area
    // If we found the level progress section, only look there
    if (levelProgressIndex >= 0) {
      // First, exclude stat patterns even within the Level Progress area
      const statPatternsInArea = [
        /games\s+won\s+[\d\s]+\s+of/i,
        /tournaments\s+won\s+[\d\s]+\s+of/i,
        /total\s+winnings/i,
        /coins\s+wallet/i,
        /win\s+percentage/i,
        /win\s+streak/i,
        /balls\s+potted/i,
      ];
      
      const statContextsInArea: Array<{ start: number; end: number }> = [];
      for (const pattern of statPatternsInArea) {
        const matches = searchText.matchAll(new RegExp(pattern, 'gi'));
        for (const match of matches) {
          if (match.index !== undefined) {
            statContextsInArea.push({ start: match.index, end: match.index + match[0].length });
          }
        }
      }
      
      // Look for 3-4 digit numbers in the level progress area (likely the level number)
      const standaloneNumberPattern = /\b(\d{3,4})\b/g;
      const matches = searchText.matchAll(standaloneNumberPattern);
      
      for (const match of matches) {
        const level = parseInt(match[1], 10);
        const matchIndex = match.index!;
        
        // Skip if it's within a stat context
        const isInStatContext = statContextsInArea.some(ctx => 
          matchIndex >= ctx.start && matchIndex <= ctx.end
        );
        if (isInStatContext) {
          continue;
        }
        
        if (level >= 100 && level <= 9999) {
          // Check context to make sure it's not part of progress bar numbers (like "8612122/9401159")
          const beforeContext = searchText.substring(Math.max(0, matchIndex - 30), matchIndex);
          const afterContext = searchText.substring(matchIndex + match[0].length, Math.min(searchText.length, matchIndex + match[0].length + 30));
          const context = (beforeContext + match[0] + afterContext).toLowerCase();
          
          // Skip if it's part of a progress bar (numbers with / or very large numbers)
          if (context.includes('/') || context.match(/\d{6,}/)) {
            continue; // This is likely a progress bar number like "8612122/9401159"
          }
          
          // Skip if it's clearly part of a stat (like "31 108" where 108 follows a smaller number)
          const beforeNum = beforeContext.match(/\b(\d{1,2})\s*$/);
          if (beforeNum && parseInt(beforeNum[1], 10) < 100) {
            // This might be part of a stat like "31 108"
            continue;
          }
          
          // Skip if it's clearly part of a larger number sequence
          const beforeLargeNum = beforeContext.match(/\b(\d{4,})\s*$/);
          if (beforeLargeNum) {
            continue; // Part of a larger number
          }
          
          // Skip if context contains stat keywords
          if (context.includes('games won') || 
              context.includes('tournaments') || 
              context.includes('winnings') || 
              context.includes('wallet') ||
              context.includes('percentage') ||
              context.includes('streak') ||
              context.includes('potted')) {
            continue;
          }
          
          foundLevels.push({ level, priority: 8, context: match[0] });
        }
      }
    }

    // Sort by priority (highest first), then by level (prefer reasonable ranges)
    if (foundLevels.length > 0) {
      foundLevels.sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        // If same priority, prefer levels in the 100-999 range (most common)
        const aScore = (a.level >= 100 && a.level <= 999) ? 1 : 0;
        const bScore = (b.level >= 100 && b.level <= 999) ? 1 : 0;
        return bScore - aScore;
      });
      
      logger.debug(`Level extraction candidates: ${JSON.stringify(foundLevels.slice(0, 3))}`);
      return foundLevels[0].level;
    }

    return null;
  }

  /**
   * Extract rank name from text - ONLY from Level Progress area
   * Looks for patterns like "Rank: Galactic Overlord" in the Level Progress section
   */
  private extractRankName(text: string): { rank: RankConfig | null; confidence: number } {
    let bestMatch: RankConfig | null = null;
    let bestConfidence = 0;
    const threshold = 0.6; // Minimum similarity threshold

    // ONLY look in the Level Progress area - find the level progress section first
    // OCR might read it as "Level progress", "evel progre", "level progre", "evel progre bhi", etc.
    const levelProgressPattern = /(?:level|evel|lvl)\s*progre(?:ss|s|bhi|bh)?/i;
    let levelProgressMatch = text.match(levelProgressPattern);
    
    // If not found, try more flexible patterns
    if (!levelProgressMatch) {
      const altPatterns = [
        /(?:level|evel|lvl)\s*prog/i,
        /evel\s*progre/i,
        /level\s*progre/i,
      ];
      for (const pattern of altPatterns) {
        levelProgressMatch = text.match(pattern);
        if (levelProgressMatch) {
          logger.debug(`Found alternative level progress pattern for rank: ${levelProgressMatch[0]}`);
          break;
        }
      }
    }
    
    let searchText = text;
    if (levelProgressMatch && levelProgressMatch.index !== undefined) {
      // Extract text around level progress (should contain both Level and Rank)
      const startIndex = Math.max(0, levelProgressMatch.index);
      const endIndex = Math.min(text.length, levelProgressMatch.index + levelProgressMatch[0].length + 200);
      searchText = text.substring(startIndex, endIndex);
      logger.debug(`Searching for rank in level progress area: ${searchText.substring(0, 150)}`);
    } else {
      logger.debug('Level progress pattern not found for rank extraction, using full text');
    }

    // First, try to find "Rank:" pattern in the Level Progress area
    const rankPattern = /rank\s*[:\-]?\s*([a-z\s]+)/i;
    const rankMatch = searchText.match(rankPattern);
    let rankTextToSearch = this.normalizeText(searchText);
    
    if (rankMatch && rankMatch[1]) {
      // Found "Rank: X" pattern, focus on the rank name part
      rankTextToSearch = this.normalizeText(rankMatch[1]);
      logger.debug(`Found rank pattern in level progress area: "${rankMatch[1]}" -> normalized: "${rankTextToSearch}"`);
    } else {
      // If no "Rank:" pattern found, use the normalized search text from level progress area
      rankTextToSearch = this.normalizeText(searchText);
    }

    for (const rank of this.ranks) {
      const normalizedRankName = this.normalizeText(rank.rank_name);
      
      // Check for exact match ONLY in the level progress area
      if (rankTextToSearch.includes(normalizedRankName)) {
        logger.debug(`Exact match found in level progress area: ${rank.rank_name}`);
        return { rank, confidence: 1.0 };
      }

      // Check if rank name is contained in the rank section (after "Rank:")
      if (normalizedRankName.includes(rankTextToSearch) || rankTextToSearch.includes(normalizedRankName)) {
        logger.debug(`Substring match found in level progress area: ${rank.rank_name}`);
        return { rank, confidence: 0.95 };
      }

      // Fuzzy match ONLY on the level progress area text
      const similarityScore = this.similarity(rankTextToSearch, normalizedRankName);

      if (similarityScore > bestConfidence) {
        bestConfidence = similarityScore;
        bestMatch = rank;
      }
    }

    if (bestConfidence >= threshold) {
      logger.debug(`Fuzzy match found: ${bestMatch?.rank_name} (confidence: ${bestConfidence})`);
      return { rank: bestMatch, confidence: bestConfidence };
    }

    logger.debug(`No rank match found (best confidence: ${bestConfidence})`);
    return { rank: null, confidence: 0 };
  }

  /**
   * Get rank from level number
   */
  private getRankFromLevel(level: number): RankConfig | null {
    for (const rank of this.ranks) {
      if (level >= rank.level_min && level <= rank.level_max) {
        return rank;
      }
    }
    return null;
  }

  /**
   * Match rank from OCR text (dual detection: level + rank name)
   */
  matchRank(ocrText: string): MatchedRank | null {
    logger.info(`Matching rank from OCR text: ${ocrText.substring(0, 500)}`);

    // Extract level
    const level = this.extractLevel(ocrText);
    logger.debug(`Extracted level: ${level}`);

    // Extract rank name
    const { rank: rankFromName, confidence: nameConfidence } = this.extractRankName(ocrText);
    logger.debug(`Extracted rank from name: ${rankFromName?.rank_name} (confidence: ${nameConfidence})`);

    // Get rank from level
    const rankFromLevel = level ? this.getRankFromLevel(level) : null;
    logger.debug(`Extracted rank from level: ${rankFromLevel?.rank_name}`);

    // Determine best match
    let finalRank: RankConfig | null = null;
    let finalConfidence = 0;

    // If both methods agree, use that with high confidence
    if (rankFromName && rankFromLevel && rankFromName.rank_name === rankFromLevel.rank_name) {
      finalRank = rankFromName;
      finalConfidence = Math.max(nameConfidence, 0.9);
    }
    // If rank name match is confident, use it
    else if (rankFromName && nameConfidence >= 0.7) {
      finalRank = rankFromName;
      finalConfidence = nameConfidence;
    }
    // If level-based match exists, use it
    else if (rankFromLevel) {
      finalRank = rankFromLevel;
      finalConfidence = 0.8; // Level-based matching is reliable
    }
    // If rank name match is above threshold, use it
    else if (rankFromName && nameConfidence >= 0.6) {
      finalRank = rankFromName;
      finalConfidence = nameConfidence;
    }

    if (!finalRank) {
      logger.warn('Could not match rank from OCR text', { ocrText: ocrText.substring(0, 200), level });
      return null;
    }

    const result: MatchedRank = {
      rank_name: finalRank.rank_name,
      role_id: finalRank.role_id,
      level_min: finalRank.level_min,
      level_max: finalRank.level_max,
      confidence: finalConfidence,
      level_detected: level || undefined,
    };

    logger.info(`Matched rank: ${result.rank_name} (confidence: ${result.confidence}, level: ${result.level_detected})`);

    return result;
  }

  /**
   * Get rank by name (for admin commands)
   */
  getRankByName(rankName: string): RankConfig | null {
    const normalized = this.normalizeText(rankName);
    return this.ranks.find(r => this.normalizeText(r.rank_name) === normalized) || null;
  }

  /**
   * Get all ranks
   */
  getAllRanks(): RankConfig[] {
    return this.ranks;
  }
}

export const rankMatcher = new RankMatcherService();

