import { GuildMember, Role, Snowflake } from 'discord.js';
import { RankConfig } from '../types';
import ranksConfig from '../config/ranks.json';
import { logger } from './logger';

class RoleManagerService {
  private rankRoleIds: Set<string>;

  constructor() {
    const ranks = ranksConfig as RankConfig[];
    this.rankRoleIds = new Set(ranks.map(rank => rank.role_id));
  }

  /**
   * Check if a role ID is a rank role
   */
  private isRankRole(roleId: string): boolean {
    return this.rankRoleIds.has(roleId);
  }

  /**
   * Get all rank roles that a member currently has
   */
  private getCurrentRankRoles(member: GuildMember): Role[] {
    return member.roles.cache.filter(role => this.isRankRole(role.id)).map(role => role);
  }

  /**
   * Remove all rank roles from a member
   */
  private async removeAllRankRoles(member: GuildMember): Promise<void> {
    const rankRoles = this.getCurrentRankRoles(member);
    
    if (rankRoles.length === 0) {
      return;
    }

    try {
      await member.roles.remove(rankRoles, 'Removing old rank roles before assigning new one');
      logger.info(`Removed ${rankRoles.length} rank role(s) from user`, {
        user_id: member.id,
        username: member.user.username,
        removed_roles: rankRoles.map(r => r.name),
      });
    } catch (error) {
      logger.error('Failed to remove rank roles', {
        error,
        user_id: member.id,
        username: member.user.username,
      });
      throw error;
    }
  }

  /**
   * Assign a rank role to a member
   */
  async assignRankRole(member: GuildMember, rank: RankConfig): Promise<boolean> {
    try {
      // First, remove all existing rank roles
      await this.removeAllRankRoles(member);

      // Get the role to assign
      const role = member.guild.roles.cache.get(rank.role_id as Snowflake);
      
      if (!role) {
        logger.error('Rank role not found in guild', {
          role_id: rank.role_id,
          rank_name: rank.rank_name,
          guild_id: member.guild.id,
        });
        return false;
      }

      // Check if member already has this role (shouldn't happen after removal, but just in case)
      if (member.roles.cache.has(rank.role_id as Snowflake)) {
        logger.debug('Member already has rank role', {
          user_id: member.id,
          role_id: rank.role_id,
          rank_name: rank.rank_name,
        });
        return true;
      }

      // Assign the new role
      await member.roles.add(role, `Assigned rank role: ${rank.rank_name}`);

      logger.info('Rank role assigned', {
        user_id: member.id,
        username: member.user.username,
        role_id: rank.role_id,
        rank_name: rank.rank_name,
      });

      return true;
    } catch (error) {
      logger.error('Failed to assign rank role', {
        error,
        user_id: member.id,
        username: member.user.username,
        role_id: rank.role_id,
        rank_name: rank.rank_name,
      });

      // Check if it's a permission error
      if (error instanceof Error && error.message.includes('Missing Permissions')) {
        throw new Error('Bot does not have permission to manage roles. Please check bot permissions.');
      }

      throw error;
    }
  }

  /**
   * Remove a specific rank role from a member
   */
  async removeRankRole(member: GuildMember, roleId: string): Promise<boolean> {
    try {
      const role = member.guild.roles.cache.get(roleId as Snowflake);
      
      if (!role) {
        logger.error('Role not found in guild', {
          role_id: roleId,
          guild_id: member.guild.id,
        });
        return false;
      }

      if (!member.roles.cache.has(roleId as Snowflake)) {
        logger.debug('Member does not have role', {
          user_id: member.id,
          role_id: roleId,
        });
        return false;
      }

      await member.roles.remove(role, 'Removing rank role');

      logger.info('Rank role removed', {
        user_id: member.id,
        username: member.user.username,
        role_id: roleId,
      });

      return true;
    } catch (error) {
      logger.error('Failed to remove rank role', {
        error,
        user_id: member.id,
        username: member.user.username,
        role_id: roleId,
      });
      throw error;
    }
  }

  /**
   * Remove all rank roles from a member (public method)
   */
  async removeAllRankRolesFromMember(member: GuildMember): Promise<void> {
    await this.removeAllRankRoles(member);
  }

  /**
   * Get the current rank role of a member (if any)
   */
  getCurrentRankRole(member: GuildMember): Role | null {
    const rankRoles = this.getCurrentRankRoles(member);
    return rankRoles.length > 0 ? rankRoles[0] : null;
  }
}

export const roleManager = new RoleManagerService();

