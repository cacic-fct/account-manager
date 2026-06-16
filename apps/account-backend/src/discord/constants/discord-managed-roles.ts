import { isUndergraduateStudentRole } from '@cacic/shared-types';
import { isUnespEmail } from '@cacic/shared-utils';
import type { UserProfile } from '../../auth/interfaces/auth.interface';

export type DiscordManagedRoleCategory = 'student' | 'unesp' | 'visitor';

export interface DiscordManagedRoleDefinition {
  category: DiscordManagedRoleCategory;
  roleId: string;
  roleName: string;
}

export const DISCORD_REGISTRATION_ROLE = {
  roleId: '872241575336476712',
  roleName: 'Cadastro',
} as const;

export const DISCORD_MANAGED_ROLES = {
  student: {
    category: 'student',
    roleId: '1516462632905871450',
    roleName: 'Aluno da Computação',
  },
  unesp: {
    category: 'unesp',
    roleId: '1516462732034052157',
    roleName: 'Unespiano Visitante',
  },
  visitor: {
    category: 'visitor',
    roleId: '1516462849549930537',
    roleName: 'Visitante externo',
  },
} as const satisfies Record<
  DiscordManagedRoleCategory,
  DiscordManagedRoleDefinition
>;

export const DISCORD_MANAGED_ROLE_IDS: string[] = Object.values(
  DISCORD_MANAGED_ROLES,
).map((role) => role.roleId);

export const DISCORD_AUTOMATED_ROLE_IDS = [
  ...DISCORD_MANAGED_ROLE_IDS,
  DISCORD_REGISTRATION_ROLE.roleId,
];

export function getDiscordManagedRoleForUser(
  user: UserProfile | null,
): DiscordManagedRoleDefinition {
  return DISCORD_MANAGED_ROLES[getDiscordManagedRoleCategory(user)];
}

export function getDiscordManagedRoleCategory(
  user: UserProfile | null,
): DiscordManagedRoleCategory {
  if (!hasUnespEmail(user)) {
    return 'visitor';
  }

  if (user?.unespRoleVerified && isComputerScienceStudent(user)) {
    return 'student';
  }

  return 'unesp';
}

export function checkComputerScienceEnrollmentPattern(
  enrollmentNumber?: string,
): boolean {
  const normalizedEnrollmentNumber = enrollmentNumber?.replace(/\D/g, '');

  if (!normalizedEnrollmentNumber || normalizedEnrollmentNumber.length < 4) {
    return false;
  }

  return normalizedEnrollmentNumber.substring(2, 4) === '12';
}

function hasUnespEmail(user: UserProfile | null): boolean {
  if (!user) {
    return false;
  }

  return [user.email, ...(user.secondaryEmails ?? [])].some((email) =>
    isUnespEmail(email),
  );
}

function isComputerScienceStudent(user: UserProfile): boolean {
  if (!user.unespRole || !isUndergraduateStudentRole(user.unespRole)) {
    return false;
  }

  return checkComputerScienceEnrollmentPattern(user.enrollmentNumber);
}
