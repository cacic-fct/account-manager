import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { M2MUserIdentifierLookupItem, M2MUserIdentifierLookupMatch, M2MUserProfile } from '@cacic/m2m-contracts';
import { KeycloakService, KeycloakUserData } from '../auth/services/keycloak.service';
import { M2M_USER_ENROLLMENT_LOOKUP_MAX_ITEMS, M2M_USER_IDENTIFIER_LOOKUP_MAX_ITEMS } from './dto/m2m-user-lookup.dto';

const KEYCLOAK_SEARCH_MAX_PER_IDENTIFIER = 50;
const LOOKUP_CONCURRENCY = 10;

@Injectable()
export class M2MUsersService {
  private readonly logger = new Logger(M2MUsersService.name);

  constructor(private readonly keycloakService: KeycloakService) {}

  async lookupByEnrollmentNumbers(enrollmentNumbers: readonly string[]): Promise<M2MUserProfile[]> {
    const normalizedEnrollmentNumbers = this.normalizeUniqueValues(
      enrollmentNumbers,
      M2M_USER_ENROLLMENT_LOOKUP_MAX_ITEMS,
      (value) => this.normalizeEnrollmentNumber(value),
    );
    const resultGroups = await this.mapWithConcurrency(
      normalizedEnrollmentNumbers,
      LOOKUP_CONCURRENCY,
      async (enrollmentNumber) => {
        const matches = await this.findUsersByAttributeValues(
          ['enrollmentNumber'],
          [enrollmentNumber],
          (user) =>
            this.normalizeEnrollmentNumber(this.firstAttributeValue(user, 'enrollmentNumber')) === enrollmentNumber,
        );

        return matches.flatMap((match) => {
          const profile = this.toUserProfile(match);
          if (!profile?.enrollmentNumber) {
            return [];
          }
          return [profile];
        });
      },
    );

    return this.dedupeUsers(resultGroups.flat());
  }

  async lookupByIdentifiers(
    identifiers: readonly M2MUserIdentifierLookupItem[],
  ): Promise<M2MUserIdentifierLookupMatch[]> {
    const normalizedIdentifiers = this.normalizeIdentifiers(identifiers);
    const resultGroups = await this.mapWithConcurrency(
      normalizedIdentifiers,
      LOOKUP_CONCURRENCY,
      async (identifier) => {
        const users = await this.findUsersForIdentifier(identifier);
        return users.flatMap((user) => {
          const profile = this.toUserProfile(user);
          if (!profile) {
            return [];
          }
          return [
            {
              ...profile,
              requestId: identifier.requestId,
            },
          ];
        });
      },
    );

    return this.dedupeIdentifierMatches(resultGroups.flat());
  }

  private async findUsersForIdentifier(identifier: M2MUserIdentifierLookupItem): Promise<KeycloakUserData[]> {
    switch (identifier.identifierType) {
      case 'email': {
        const user = await this.keycloakService.findUserByEmail(identifier.identifierValue);
        return user ? [user] : [];
      }
      case 'cpf': {
        const normalizedCpf = this.normalizeCpf(identifier.identifierValue);
        if (!normalizedCpf) {
          throw new BadRequestException(`Invalid CPF for request ${identifier.requestId}.`);
        }

        return this.findUsersByAttributeValues(
          ['identity-document', 'identityDocument'],
          [normalizedCpf],
          (user) =>
            this.normalizeCpf(this.firstAttributeValue(user, 'identity-document', 'identityDocument')) ===
            normalizedCpf,
        );
      }
      case 'phone': {
        const normalizedPhone = this.normalizePhone(identifier.identifierValue);
        if (!normalizedPhone) {
          throw new BadRequestException(`Invalid phone for request ${identifier.requestId}.`);
        }

        return this.findUsersByAttributeValues(
          ['phone'],
          [normalizedPhone, `+${normalizedPhone}`],
          (user) => this.normalizePhone(this.firstAttributeValue(user, 'phone')) === normalizedPhone,
        );
      }
    }
  }

  private async findUsersByAttributeValues(
    attributeNames: readonly string[],
    attributeValues: readonly string[],
    isExactMatch: (user: KeycloakUserData) => boolean,
  ): Promise<KeycloakUserData[]> {
    const usersById = new Map<string, KeycloakUserData>();

    for (const attributeName of attributeNames) {
      for (const attributeValue of attributeValues) {
        try {
          const users = await this.keycloakService.searchUsersByAttribute(attributeName, attributeValue, {
            max: KEYCLOAK_SEARCH_MAX_PER_IDENTIFIER,
          });
          if (users.length >= KEYCLOAK_SEARCH_MAX_PER_IDENTIFIER) {
            throw new ServiceUnavailableException('Keycloak lookup is ambiguous and cannot be returned completely.');
          }

          for (const user of users) {
            if (isExactMatch(user)) {
              usersById.set(user.id, user);
            }
          }
        } catch (error) {
          this.logger.warn('Keycloak user attribute lookup failed.', {
            attributeName,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          throw error;
        }
      }
    }

    return [...usersById.values()];
  }

  private normalizeIdentifiers(identifiers: readonly M2MUserIdentifierLookupItem[]): M2MUserIdentifierLookupItem[] {
    if (identifiers.length > M2M_USER_IDENTIFIER_LOOKUP_MAX_ITEMS) {
      throw new BadRequestException(`At most ${M2M_USER_IDENTIFIER_LOOKUP_MAX_ITEMS} identifiers are allowed.`);
    }
    const normalized: M2MUserIdentifierLookupItem[] = [];
    const seen = new Set<string>();

    for (const identifier of identifiers) {
      const requestId = identifier.requestId.trim();
      const identifierValue = identifier.identifierValue.trim();

      if (!requestId || !identifierValue) {
        throw new BadRequestException('Every identifier requires a requestId and identifierValue.');
      }
      if (!['cpf', 'phone', 'email'].includes(identifier.identifierType)) {
        throw new BadRequestException('identifierType must be cpf, phone, or email.');
      }

      const key = `${requestId}:${identifier.identifierType}:${identifierValue}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      normalized.push({
        requestId,
        identifierType: identifier.identifierType,
        identifierValue: identifier.identifierType === 'email' ? identifierValue.toLowerCase() : identifierValue,
      });
    }

    return normalized;
  }

  private normalizeUniqueValues(
    values: readonly string[],
    maxItems: number,
    normalize: (value: string) => string | null,
  ): string[] {
    if (values.length > maxItems) {
      throw new BadRequestException(`At most ${maxItems} lookup values are allowed.`);
    }
    const normalized: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const normalizedValue = normalize(value);
      if (!normalizedValue) {
        throw new BadRequestException('Lookup values must be non-empty and valid.');
      }
      if (seen.has(normalizedValue)) {
        continue;
      }

      seen.add(normalizedValue);
      normalized.push(normalizedValue);
    }

    return normalized;
  }

  private toUserProfile(user: KeycloakUserData): M2MUserProfile | null {
    const userId = user.id.trim();
    if (!userId) {
      return null;
    }

    const email = this.firstNonEmpty(user.email, this.firstAttributeValue(user, 'email'));
    const federatedFullName = this.firstNonEmpty([user.firstName, user.lastName].filter(Boolean).join(' '));
    const name = this.firstNonEmpty(
      this.firstAttributeValue(user, 'fullName'),
      this.firstAttributeValue(user, 'displayName'),
      federatedFullName,
      email,
      user.username,
      userId,
    );

    if (!name) {
      return null;
    }

    const unespRole = this.firstAttributeValue(user, 'unespRole', 'unesp_role');
    const unespRoleVerified = this.booleanAttributeValue(user, 'unespRoleVerified', 'unesp_role_verified');
    const secondaryEmails = this.normalizeSecondaryEmails(user);

    return {
      userId,
      name,
      email: email ?? null,
      enrollmentNumber: this.normalizeEnrollmentNumber(this.firstAttributeValue(user, 'enrollmentNumber')) ?? null,
      ...(unespRole ? { unespRole } : {}),
      ...(unespRoleVerified === undefined ? {} : { unespRoleVerified }),
      ...(secondaryEmails.length ? { secondaryEmails } : {}),
    };
  }

  private firstAttributeValue(user: KeycloakUserData, ...attributeNames: string[]): string | undefined {
    const attributes = user.attributes ?? {};

    for (const attributeName of attributeNames) {
      const value = attributes[attributeName]?.find((candidate) => candidate.trim());
      if (value) {
        return value.trim();
      }
    }

    return undefined;
  }

  private booleanAttributeValue(user: KeycloakUserData, ...attributeNames: string[]): boolean | undefined {
    const value = this.firstAttributeValue(user, ...attributeNames)?.toLowerCase();
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return undefined;
  }

  private normalizeSecondaryEmails(user: KeycloakUserData): string[] {
    const normalized = new Set<string>();

    for (const value of this.attributeValues(user, 'secondaryEmails', 'secondary_emails')) {
      for (const candidate of this.parseStringList(value)) {
        const email = this.normalizeEmail(candidate);
        if (email) {
          normalized.add(email);
        }
      }
    }

    return [...normalized];
  }

  private attributeValues(user: KeycloakUserData, ...attributeNames: string[]): string[] {
    const attributes = user.attributes ?? {};
    return attributeNames.flatMap((attributeName) => attributes[attributeName] ?? []);
  }

  private parseStringList(value: string): string[] {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string');
        }
      } catch {
        return [trimmed];
      }
    }

    return trimmed.split(',').map((item) => item.trim());
  }

  private normalizeEmail(value: string): string | null {
    const normalized = value.trim().toLowerCase();
    return normalized || null;
  }

  private firstNonEmpty(...values: readonly (string | undefined | null)[]): string | undefined {
    for (const value of values) {
      const trimmed = value?.trim();
      if (trimmed) {
        return trimmed;
      }
    }

    return undefined;
  }

  private normalizeEnrollmentNumber(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized && normalized.length <= 64 ? normalized : null;
  }

  private normalizeCpf(value: string | undefined): string | null {
    const digits = value?.replace(/\D/g, '') ?? '';
    return digits.length === 11 ? digits : null;
  }

  private normalizePhone(value: string | undefined): string | null {
    const digits = value?.replace(/\D/g, '') ?? '';
    return digits.length >= 10 && digits.length <= 13 ? digits : null;
  }

  private dedupeUsers(users: readonly M2MUserProfile[]): M2MUserProfile[] {
    const usersByKey = new Map<string, M2MUserProfile>();
    for (const user of users) {
      usersByKey.set(`${user.userId}:${user.enrollmentNumber ?? ''}`, user);
    }

    return [...usersByKey.values()];
  }

  private dedupeIdentifierMatches(users: readonly M2MUserIdentifierLookupMatch[]): M2MUserIdentifierLookupMatch[] {
    const usersByKey = new Map<string, M2MUserIdentifierLookupMatch>();
    for (const user of users) {
      usersByKey.set(`${user.requestId}:${user.userId}`, user);
    }

    return [...usersByKey.values()];
  }

  private async mapWithConcurrency<T, R>(
    values: readonly T[],
    concurrency: number,
    mapper: (value: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(values.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index]);
      }
    });
    await Promise.all(workers);
    return results;
  }
}
