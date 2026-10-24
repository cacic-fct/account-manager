import { isStudentRole, UnespRole } from '../enums/unesp-role.enum';

// Increment for every user schema change, including compatible changes.
export const CURRENT_USER_SCHEMA_VERSION: number = 1;

// Advance to CURRENT_USER_SCHEMA_VERSION only when users must complete onboarding
// again. Zero preserves completed legacy profiles during this compatible rollout.
// Optional fields and compatible changes leave this threshold unchanged.
export const REQUIRED_ONBOARDING_SCHEMA_VERSION: number = 0;

export function getUserSchemaVersion(attributes: Record<string, string[]>): number {
  const value = attributes.userSchemaVersion?.[0] ?? '';
  const version = Number(value);
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(version) ? version : 0;
}

export function getMissingUserProfileFields(attributes: Record<string, string[]>): string[] {
  const requiredFields = ['identity-document', 'phone', 'fullName'];

  if (attributes.isForeigner?.[0] === 'true') {
    requiredFields.push('passportCountry');
  }

  if (isStudentRole(attributes.unespRole?.[0] as UnespRole)) {
    requiredFields.push('enrollmentNumber');
  }

  return requiredFields.filter((field) => !attributes[field]?.[0]?.trim());
}

export function getUserOnboardingStatus(attributes: Record<string, string[]>): {
  needsOnboarding: boolean;
  missingFields: string[];
} {
  const missingFields = getMissingUserProfileFields(attributes);
  return {
    needsOnboarding:
      attributes.isOnboarded?.[0] !== 'true' ||
      getUserSchemaVersion(attributes) < REQUIRED_ONBOARDING_SCHEMA_VERSION ||
      missingFields.length > 0,
    missingFields,
  };
}
