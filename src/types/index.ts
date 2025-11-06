export interface RankConfig {
  role_id: string;
  rank_name: string;
  level_min: number;
  level_max: number;
}

export interface MatchedRank {
  rank_name: string;
  role_id: string;
  level_min: number;
  level_max: number;
  confidence: number;
  level_detected?: number;
}

export interface OCRResult {
  text: string;
  confidence: number;
}

export interface VerificationData {
  discord_id: string;
  username: string;
  rank_name: string;
  level_detected: number;
  role_id_assigned: string;
}

export interface LogEntry {
  timestamp: Date;
  action_type: 'role_assigned' | 'verification_updated' | 'command_executed' | 'error' | 'ocr_processed';
  user_id?: string;
  username?: string;
  rank_name?: string;
  level_detected?: number;
  role_id_assigned?: string;
  success: boolean;
  error_message?: string;
  command_name?: string;
}

