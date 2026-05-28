import { Injectable, Logger } from '@nestjs/common';
import type { DiscordLink } from '@prisma/client';
import { UserService } from '../../auth/services/user.service';
import { UserProfile } from '../../auth/interfaces/auth.interface';
import { isUndergraduateStudentRole } from '@cacic/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { isUnespEmail } from '@cacic/shared-utils';

@Injectable()
export class DiscordRoleService {
  private readonly logger = new Logger(DiscordRoleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private userService: UserService,
  ) {}

  /**
   * Check which role user is eligible for
   */
  async checkRoleEligibility(
    userId: string,
  ): Promise<'student' | 'unesp' | 'visitor'> {
    const user = await this.getUserByKeycloakId(userId);
    return this.getUserEligibleRole(user);
  }

  /**
   * Check if user is eligible for computer science student role
   * Requires: verification completion + student role + xx12* enrollment pattern
   */
  async checkStudentEligibility(userId: string): Promise<boolean> {
    const eligibleRole = await this.checkRoleEligibility(userId);
    return eligibleRole === 'student';
  }

  /**
   * Get user by Keycloak ID
   */
  async getUserByKeycloakId(
    keycloakUserId: string,
  ): Promise<UserProfile | null> {
    try {
      return await this.userService.findByKeycloakId(keycloakUserId);
    } catch (error) {
      this.logger.error('Error getting user by Keycloak ID', error);
      return null;
    }
  }

  /**
   * Check if enrollment number matches computer science student pattern (xx12*)
   */
  checkEnrollmentPattern(enrollmentNumber?: string): boolean {
    if (!enrollmentNumber || enrollmentNumber.length < 4) {
      return false;
    }
    return enrollmentNumber.substring(2, 4) === '12';
  }

  /**
   * Assign role to Discord user based on their linked account and verification status
   */
  async assignUserRole(discordLink: DiscordLink): Promise<void> {
    const user = await this.userService.findByKeycloakId(discordLink.userId);
    const eligibleRole = this.getUserEligibleRole(user);

    const roleMapping = {
      student: 'Computer Science Student',
      unesp: 'Unesp Student',
      visitor: 'Visitor',
    } as const;

    const roleName = roleMapping[eligibleRole];

    await this.prisma.discordLink.update({
      where: { id: discordLink.id },
      data: { assignedRole: roleName },
    });

    this.logger.debug(
      `Discord role assigned - User: ${discordLink.discordGlobalName}, Role: ${roleName}, Eligibility: ${eligibleRole}`,
      {
        userId: discordLink.userId,
        discordId: discordLink.discordId,
        userEmail: user?.email,
        isVerified: user?.unespRoleVerified,
        unespRole: user?.unespRole,
        enrollmentNumber: user?.enrollmentNumber,
      },
    );
  }

  private getUserEligibleRole(
    user: UserProfile | null,
  ): 'student' | 'unesp' | 'visitor' {
    if (!user?.email) {
      return 'visitor';
    }

    if (!isUnespEmail(user.email)) {
      return 'visitor';
    }

    if (user.unespRoleVerified && this.isComputerScienceStudent(user)) {
      return 'student';
    }

    return 'unesp';
  }

  private isComputerScienceStudent(user: UserProfile): boolean {
    if (!user.unespRole || !isUndergraduateStudentRole(user.unespRole)) {
      return false;
    }

    const enrollmentNumber = user.enrollmentNumber;
    if (!enrollmentNumber || enrollmentNumber.length < 4) {
      return false;
    }

    return enrollmentNumber.substring(2, 4) === '12';
  }

  private isEligibleForStudentRole(user: UserProfile | null): boolean {
    return this.getUserEligibleRole(user) === 'student';
  }
}
