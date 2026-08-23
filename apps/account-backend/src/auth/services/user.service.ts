import { BadRequestException, HttpException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { UserProfile, KeycloakUser } from '../interfaces/auth.interface';
import { CreateUserProfileDto, UserProfileDto } from '../dto/user-profile.dto';
import { KeycloakService } from './keycloak.service';
import { KeycloakConnectionException } from '../exceptions/keycloak-connection.exception';
import { UnespRole, isProfessorEmail, isStudentRole } from '../enums/unesp-role.enum';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { isUnespEmail } from '@cacic/shared-utils';
import { AccountManagerPermission } from '@cacic/shared-types';
import { EventManagerProfileSyncService } from './event-manager-profile-sync.service';
import { AccountPermissionService } from './account-permission.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly accountPermissionService: AccountPermissionService,
    private readonly prisma: PrismaService,
    @Optional()
    private readonly eventManagerProfileSync?: EventManagerProfileSyncService,
  ) {}

  /**
   * Check if user is part of Unesp (has @unesp.br email or is in Unesp group)
   */
  private async isUnespUser(email: string, userId: string): Promise<boolean> {
    // Check if user has @unesp.br email
    if (isUnespEmail(email)) {
      return true;
    }

    // Check if user is in Unesp group
    try {
      const userGroups = await this.keycloakService.getUserGroups(userId);
      return userGroups.some((group) => group.toLowerCase().includes('unesp'));
    } catch (error) {
      this.logger.error('Error checking user groups', error);
      return false;
    }
  }

  /**
   * Automatically determine Unesp role based on email and business rules
   */
  private determineUnespRole(email: string): UnespRole | undefined {
    if (!isUnespEmail(email)) {
      return undefined;
    }

    // Check if email is in professor list
    if (isProfessorEmail(email)) {
      return UnespRole.PROFESSOR;
    }

    // Default to undefined - user will need to select their role
    return undefined;
  }

  private validatePhone(phone: string): string {
    const parsed = parsePhoneNumberFromString(phone.trim()) || parsePhoneNumberFromString(phone.trim(), 'BR');

    if (!parsed || !parsed.isValid()) {
      throw new BadRequestException('Invalid phone number format. Please use a valid international phone number.');
    }

    return parsed.number;
  }

  private normalizeIdentityDocument(identityDocument: string, isForeigner: boolean): string {
    const trimmed = identityDocument.trim();
    if (isForeigner) {
      if (trimmed.length < 5 || trimmed.length > 64 || !/^[\p{L}\p{N} .'-]+$/u.test(trimmed)) {
        throw new BadRequestException('Invalid passport document format.');
      }
      return trimmed;
    }

    const cpf = trimmed.replace(/\D/g, '');
    if (cpf.length !== 11) {
      throw new BadRequestException('CPF must contain exactly 11 digits.');
    }
    return cpf;
  }

  private assertRegisteredIdentityFieldsUnchanged(
    currentAttributes: Record<string, string[]>,
    updateData: CreateUserProfileDto,
  ): {
    fullName: string;
    identityDocument: string;
    isForeigner: boolean;
    passportCountry?: string;
  } {
    const currentFullName = currentAttributes.fullName?.[0]?.trim() || '';
    const currentIdentityDocument = currentAttributes['identity-document']?.[0]?.trim() || '';
    const currentIsForeigner = currentAttributes.isForeigner?.[0] === 'true';
    const currentPassportCountry = currentAttributes.passportCountry?.[0]?.trim().toUpperCase() || undefined;
    const effectiveIsForeigner = currentIdentityDocument ? currentIsForeigner : updateData.isForeigner;
    const hasRegisteredIdentity = currentFullName !== '' || currentIdentityDocument !== '';

    if (!hasRegisteredIdentity) {
      return {
        fullName: updateData.fullname.trim(),
        identityDocument: this.normalizeIdentityDocument(updateData.identityDocument, updateData.isForeigner),
        isForeigner: updateData.isForeigner,
        ...(updateData.isForeigner && updateData.passportCountry
          ? { passportCountry: updateData.passportCountry }
          : {}),
      };
    }

    if (currentFullName && updateData.fullname.trim() !== currentFullName) {
      throw new BadRequestException('Nome completo não pode ser alterado após o cadastro.');
    }

    if (currentIdentityDocument && currentIsForeigner !== updateData.isForeigner) {
      throw new BadRequestException('Tipo de documento não pode ser alterado após o cadastro.');
    }

    const normalizedCurrentIdentityDocument = this.normalizeIdentityDocument(
      currentIdentityDocument,
      currentIsForeigner,
    );
    const normalizedIncomingIdentityDocument = this.normalizeIdentityDocument(
      updateData.identityDocument,
      effectiveIsForeigner,
    );

    if (normalizedCurrentIdentityDocument && normalizedIncomingIdentityDocument !== normalizedCurrentIdentityDocument) {
      throw new BadRequestException(
        currentIsForeigner
          ? 'Documento de identidade não pode ser alterado após o cadastro.'
          : 'CPF não pode ser alterado após o cadastro.',
      );
    }

    if (effectiveIsForeigner && currentPassportCountry && updateData.passportCountry !== currentPassportCountry) {
      throw new BadRequestException('País emissor do passaporte não pode ser alterado após o cadastro.');
    }

    return {
      fullName: currentFullName || updateData.fullname.trim(),
      identityDocument: currentIdentityDocument || normalizedIncomingIdentityDocument,
      isForeigner: effectiveIsForeigner,
      ...(effectiveIsForeigner ? { passportCountry: currentPassportCountry || updateData.passportCountry } : {}),
    };
  }

  async findByKeycloakId(keycloakId: string): Promise<UserProfile | null> {
    try {
      // First check if the user exists in Keycloak
      const userBasicInfo = await this.keycloakService.getUserBasicInfo(keycloakId);
      if (!userBasicInfo) {
        return null;
      }

      const attributes = await this.keycloakService.getUserAttributes(keycloakId);

      // If no email in attributes but user exists, use the basic info email
      const userEmail = attributes.email?.[0] || userBasicInfo.email;
      if (!userEmail) {
        this.logger.warn('User exists but has no email', { keycloakId });
        return null;
      }

      const profile = this.attributesToUserProfile(keycloakId, attributes, userBasicInfo);
      await this.upsertLeanUser(profile);
      return profile;
    } catch (error) {
      this.logger.error('Error finding user by Keycloak ID', error);
      throw error;
    }
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    try {
      const keycloakUser = await this.keycloakService.findUserByEmail(email);
      if (!keycloakUser) {
        return null;
      }

      const attributes = await this.keycloakService.getUserAttributes(keycloakUser.id);
      const profile = this.attributesToUserProfile(keycloakUser.id, attributes);
      await this.upsertLeanUser(profile);
      return profile;
    } catch (error) {
      this.logger.error('Error finding user by email', error);
      throw error;
    }
  }

  async createFromKeycloak(keycloakUser: KeycloakUser): Promise<UserProfile> {
    const existingUser = await this.findByKeycloakId(keycloakUser.sub);
    if (existingUser) {
      return existingUser;
    }

    this.logger.debug('Creating user from Keycloak data', { userId: keycloakUser.sub });

    const isUnespUser = await this.isUnespUser(keycloakUser.email, keycloakUser.sub);
    const displayName =
      keycloakUser.name || `${keycloakUser.given_name || ''} ${keycloakUser.family_name || ''}`.trim();

    // Determine initial Unesp role (professors get auto-assigned)
    const unespRole = this.determineUnespRole(keycloakUser.email);

    const attributes = {
      email: [keycloakUser.email],
      username: [keycloakUser.email],
      fullName: isUnespUser ? [displayName] : [''], // Auto-fill for Unesp users
      displayName: [displayName],
      ...(keycloakUser.picture && { picture: [keycloakUser.picture] }), // Store profile picture if available
      phone: [''], // Required field, will be filled during onboarding
      ...(isUnespUser && { enrollmentNumber: [''] }), // Only for Unesp users
      'identity-document': [''], // Required field, will be filled during onboarding
      isForeigner: ['false'], // Default to Brazilian (CPF)
      isOnboarded: ['false'],
      ...(unespRole && { unespRole: [unespRole] }), // Set role if determined
      createdAt: [new Date().toISOString()],
      updatedAt: [new Date().toISOString()],
    };

    this.logger.debug('Prepared initial Keycloak attributes', {
      userId: keycloakUser.sub,
      attributeCount: Object.keys(attributes).length,
    });

    try {
      await this.keycloakService.updateUserAttributes(
        keycloakUser.sub,
        attributes,
        { skipValidation: true }, // Skip validation during user creation
      );

      this.logger.debug('User attributes updated successfully', {
        userId: keycloakUser.sub,
      });
      const profile = this.attributesToUserProfile(keycloakUser.sub, attributes);
      await this.upsertLeanUser(profile);
      return profile;
    } catch (error) {
      this.logger.error('Error updating user attributes during creation', error);
      throw error;
    }
  }

  async updateProfile(userId: string, updateData: CreateUserProfileDto): Promise<UserProfile> {
    try {
      this.logger.debug('Updating profile for user', { userId });

      // First, verify the user exists by checking basic user data
      const userBasicInfo = await this.keycloakService.getUserBasicInfo(userId);
      if (!userBasicInfo) {
        this.logger.error('User not found in Keycloak', { userId });
        throw new NotFoundException('User not found');
      }

      const currentAttributes = await this.keycloakService.getUserAttributes(userId);

      this.logger.debug('Current user attributes retrieved', {
        userId,
        attributeKeys: Object.keys(currentAttributes),
      });

      // For newly created users, email might not be in attributes yet
      // But we know the user exists from the previous check
      const userEmail = currentAttributes.email?.[0] || userBasicInfo.email;
      if (!userEmail) {
        this.logger.error('User found but has no email in basic info or attributes', { userId });
        throw new BadRequestException('User is missing required email information');
      }

      // Validate that all required fields are provided before marking as onboarded
      const requiredFields = ['fullname', 'phone', 'identityDocument'];
      const missingRequiredFields = requiredFields.filter((field) => {
        const value =
          field === 'fullname'
            ? isUnespEmail(userEmail)
              ? currentAttributes.fullName?.[0] || updateData.fullname
              : updateData.fullname
            : updateData[field as keyof CreateUserProfileDto];
        return !value || (typeof value === 'string' && value.trim() === '');
      });

      if (missingRequiredFields.length > 0) {
        this.logger.error('Cannot mark user as onboarded - missing required fields', {
          userId,
          missingRequiredFields,
        });
        throw new BadRequestException(`Missing required fields: ${missingRequiredFields.join(', ')}`);
      }

      const immutableIdentityFields = this.assertRegisteredIdentityFieldsUnchanged(currentAttributes, updateData);

      // Validate phone number using libphonenumber-js and normalize to E.164
      updateData.phone = this.validatePhone(updateData.phone);

      // Check if fullName is locked (for external verified users)
      const isFullNameLocked = currentAttributes.fullNameLocked?.[0] === 'true';
      const currentFullName = currentAttributes.fullName?.[0];

      if (isFullNameLocked && currentFullName && updateData.fullname !== currentFullName) {
        throw new BadRequestException(
          'Nome completo não pode ser alterado após verificação por documento. Entre em contato com o suporte se necessário.',
        );
      }

      // Ensure we have the basic required attributes for new users
      const updatedAttributes: Record<string, string[]> = {
        email: currentAttributes.email || [userBasicInfo.email],
        username: currentAttributes.username || [userBasicInfo.email],
        displayName: currentAttributes.displayName || [userBasicInfo.email.split('@')[0]],
        ...currentAttributes,
        // Preserve registered identity fields once they have stored values.
        fullName:
          isFullNameLocked && currentFullName
            ? [currentFullName] // Keep locked fullname
            : isUnespEmail(userEmail)
              ? currentAttributes.fullName || [immutableIdentityFields.fullName]
              : [immutableIdentityFields.fullName],
        phone: [updateData.phone],
        'identity-document': [immutableIdentityFields.identityDocument],
        isForeigner: [immutableIdentityFields.isForeigner.toString()],
        ...(immutableIdentityFields.passportCountry
          ? { passportCountry: [immutableIdentityFields.passportCountry] }
          : {}),
        isOnboarded: ['true'], // Only set to true if all validations pass
        updatedAt: [new Date().toISOString()],
      };

      // Check if user is part of Unesp to determine if Unesp role should be included
      const isUnespUser = await this.isUnespUser(userEmail, userId);

      // Check if critical verification attributes are changing
      const currentUnespRole = currentAttributes.unespRole?.[0];
      const currentEnrollmentNumber = currentAttributes.enrollmentNumber?.[0];
      let shouldInvalidateVerification = false;
      const normalizedEnrollmentNumber = updateData.enrollmentNumber?.trim() || '';
      const hasEnrollmentInput = normalizedEnrollmentNumber.length > 0;
      const effectiveUnespRole =
        (isUnespUser ? updateData.unespRole || (currentUnespRole as UnespRole | undefined) : undefined) || undefined;

      // Enforce enrollment number only for student roles
      if (hasEnrollmentInput && (!effectiveUnespRole || !isStudentRole(effectiveUnespRole))) {
        throw new BadRequestException('Enrollment number can only be set for student roles');
      }

      // Add enrollmentNumber only if provided
      if (hasEnrollmentInput) {
        updatedAttributes.enrollmentNumber = [normalizedEnrollmentNumber];

        // Check if enrollment number is changing
        if (currentEnrollmentNumber && currentEnrollmentNumber !== normalizedEnrollmentNumber) {
          shouldInvalidateVerification = true;
          this.logger.debug('Enrollment number changed, will invalidate verification', {
            userId,
          });
        }
      }

      // Add Unesp role only if user is part of Unesp and role is provided
      if (isUnespUser && updateData.unespRole) {
        updatedAttributes.unespRole = [updateData.unespRole];

        // Check if Unesp role is changing
        if (currentUnespRole && currentUnespRole !== updateData.unespRole.toString()) {
          shouldInvalidateVerification = true;
          this.logger.debug('Unesp role changed, will invalidate verification', {
            userId,
            from: currentUnespRole,
            to: updateData.unespRole,
          });
        }

        // Validate enrollment number is required for student roles
        if (isStudentRole(updateData.unespRole) && !hasEnrollmentInput && !currentEnrollmentNumber) {
          throw new BadRequestException('Enrollment number is required for student roles');
        }

        // Clear stale enrollment when switching away from student roles
        if (currentUnespRole !== updateData.unespRole.toString() && !isStudentRole(updateData.unespRole)) {
          updatedAttributes.enrollmentNumber = [''];

          if (currentEnrollmentNumber) {
            shouldInvalidateVerification = true;
          }
        }
      }

      // Invalidate verification if critical attributes changed
      if (shouldInvalidateVerification) {
        this.logger.debug('Invalidating Unesp role verification due to critical attribute changes', { userId });
        updatedAttributes.unespRoleVerified = ['false'];
      }

      // Ensure createdAt exists
      if (!updatedAttributes.createdAt) {
        updatedAttributes.createdAt = [new Date().toISOString()];
      }

      await this.keycloakService.updateUserAttributes(userId, updatedAttributes);

      const updatedProfile = this.attributesToUserProfile(userId, updatedAttributes);
      await this.upsertLeanUser(updatedProfile);
      await this.notifyProfileUpdated(updatedProfile);

      return updatedProfile;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Error updating user profile', error);
      throw new Error('Failed to update user profile');
    }
  }

  async findById(id: string): Promise<UserProfile | null> {
    return this.findByKeycloakId(id);
  }

  /**
   * Check if user should show Unesp role selection
   */
  async shouldShowUnespRoleSelection(userId: string): Promise<boolean> {
    try {
      const userBasicInfo = await this.keycloakService.getUserBasicInfo(userId);
      if (!userBasicInfo) {
        return false;
      }

      return await this.isUnespUser(userBasicInfo.email, userId);
    } catch (error) {
      this.logger.error('Error checking Unesp role selection requirement', error);
      return false;
    }
  }

  async toDto(user: UserProfile): Promise<UserProfileDto> {
    // Check admin status
    let isAdmin = false;
    let adminGroups: string[] = [];

    try {
      const hasSuperAdminAccess = await this.accountPermissionService.hasAccountManagerSuperAdminAccess(
        user.keycloakId,
      );
      isAdmin =
        hasSuperAdminAccess || (await this.accountPermissionService.hasAccountManagerAdminAccess(user.keycloakId));

      if (hasSuperAdminAccess) {
        adminGroups = [AccountManagerPermission.SuperAdmin];
      } else if (isAdmin) {
        adminGroups = ['db-backed-admin'];
      }
    } catch (error) {
      this.logger.error('Error checking admin status for user DTO', error);
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      secondaryEmails: user.secondaryEmails,
      fullname: user.fullname,
      displayName: user.displayName,
      picture: user.picture,
      phone: user.phone,
      enrollmentNumber: user.enrollmentNumber,
      identityDocument: user.identityDocument,
      isForeigner: user.isForeigner,
      passportCountry: user.passportCountry,
      isOnboarded: user.isOnboarded,
      unespRole: user.unespRole,
      unespRoleVerified: user.unespRoleVerified,
      externalUserVerified: user.externalUserVerified,
      fullNameLocked: user.fullNameLocked,
      isAdmin,
      adminGroups,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async checkOnboardingStatus(userId: string): Promise<{
    needsOnboarding: boolean;
    missingFields: string[];
  }> {
    try {
      const attributes = await this.keycloakService.getUserAttributes(userId);

      // Define required fields for onboarding completion
      const requiredFields = ['identity-document', 'phone', 'fullName'];
      const missingFields: string[] = [];

      if (attributes.isForeigner?.[0] === 'true') {
        requiredFields.push('passportCountry');
      }

      // Check which required fields are missing
      for (const field of requiredFields) {
        const value = attributes[field]?.[0];
        if (!value || value.trim() === '') {
          missingFields.push(field);
        }
      }

      // First check if user is explicitly marked as onboarded
      const isOnboardedFlag = attributes.isOnboarded?.[0];

      this.logger.debug('Checking onboarding status for user', {
        userId,
        isOnboardedFlag,
        missingFields,
        hasAllRequiredFields: missingFields.length === 0,
        hasAttributes: Object.keys(attributes).length > 0,
      });

      // User is considered onboarded ONLY if:
      // 1. They are explicitly marked as onboarded AND
      // 2. They have all required fields filled
      const isFullyOnboarded = isOnboardedFlag === 'true' && missingFields.length === 0;

      // If they're marked as onboarded but missing fields, reset their onboarded status
      if (isOnboardedFlag === 'true' && missingFields.length > 0) {
        this.logger.warn('User marked as onboarded but missing required fields, resetting onboarded flag', {
          userId,
          missingFields,
        });

        // Reset the onboarded flag since they don't actually have all required data
        await this.keycloakService.updateUserAttributes(userId, {
          ...attributes,
          isOnboarded: ['false'],
          updatedAt: [new Date().toISOString()],
        });
      }

      this.logger.debug('Final onboarding status for user', {
        userId,
        needsOnboarding: !isFullyOnboarded,
        missingFields,
        isFullyOnboarded,
      });

      return {
        needsOnboarding: !isFullyOnboarded,
        missingFields,
      };
    } catch (error) {
      // If it's a connection error to Keycloak, re-throw it so the controller can handle it appropriately
      if (error instanceof KeycloakConnectionException) {
        this.logger.error('Keycloak connection error while checking onboarding status', error);
        throw error;
      }

      // For other errors (user not found, etc.), log and return a generic error state
      this.logger.error('Error checking onboarding status', error);
      throw new Error('Unable to verify user onboarding status');
    }
  }

  /**
   * Update user data from Keycloak OAuth (refresh profile picture, display name, etc.)
   */
  async updateFromKeycloakOAuth(keycloakUser: KeycloakUser): Promise<UserProfile> {
    try {
      this.logger.debug('Updating user data from Keycloak OAuth', {
        userId: keycloakUser.sub,
      });

      // Get current user attributes
      const currentAttributes = await this.keycloakService.getUserAttributes(keycloakUser.sub);

      this.logger.debug('Current user attributes before update', {
        userId: keycloakUser.sub,
        hasCurrentPicture: !!currentAttributes.picture?.[0],
        attributeCount: Object.keys(currentAttributes).length,
      });

      // Always update display name and picture from OAuth
      const displayName =
        keycloakUser.name || `${keycloakUser.given_name || ''} ${keycloakUser.family_name || ''}`.trim();

      const updatedAttributes: Record<string, string[]> = {
        ...currentAttributes,
        displayName: [displayName],
        updatedAt: [new Date().toISOString()],
        // Always update picture if available from OAuth
        ...(keycloakUser.picture && { picture: [keycloakUser.picture] }),
      };

      this.logger.debug('Updated attributes to be stored', {
        userId: keycloakUser.sub,
        willStorePicture: !!updatedAttributes.picture,
      });

      // For Unesp users, also update fullName if it's empty or if we got a new name from OAuth
      const isUnespUser = await this.isUnespUser(keycloakUser.email, keycloakUser.sub);
      if (isUnespUser && displayName) {
        // Only update fullName if it's currently empty or if this is a substantial update
        const currentFullName = currentAttributes.fullName?.[0];
        if (!currentFullName || currentFullName.trim() === '') {
          updatedAttributes.fullName = [displayName];
        }
      }

      await this.keycloakService.updateUserAttributes(
        keycloakUser.sub,
        updatedAttributes,
        { skipValidation: true }, // Skip validation since we're just updating OAuth data
      );

      const profile = this.attributesToUserProfile(keycloakUser.sub, updatedAttributes);
      await this.upsertLeanUser(profile);
      return profile;
    } catch (error) {
      this.logger.error('Error updating user from Keycloak OAuth', {
        userId: keycloakUser.sub,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      // If update fails, still return the current user profile
      const existingUser = await this.findByKeycloakId(keycloakUser.sub);
      if (!existingUser) {
        throw new Error('User not found after OAuth update failure');
      }
      return existingUser;
    }
  }

  async deleteUserData(userId: string): Promise<void> {
    try {
      this.logger.debug('Deleting user data for user', { userId });

      const user = await this.keycloakService.getUserBasicInfo(userId);
      if (!user) {
        this.logger.warn('User not found in Keycloak, may have been already deleted', { userId });
        return;
      }

      // Clear all custom attributes from Keycloak while keeping the core user record
      // This preserves audit trails while removing personal data
      const clearedAttributes = {
        fullName: ['[DELETED]'],
        phone: [''],
        'identity-document': [''],
        enrollmentNumber: [''],
        displayName: ['[DELETED]'],
        isOnboarded: ['false'],
        unespRole: [''],
        isForeigner: ['false'],
        picture: [''],
      };

      await this.keycloakService.updateUserAttributes(userId, clearedAttributes, { skipValidation: true });

      this.logger.log('User data successfully cleared', { userId });
    } catch (error) {
      this.logger.error('Error deleting user data', error);
      throw new Error(`Failed to delete user data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async notifyProfileUpdated(profile: UserProfile): Promise<void> {
    if (!this.eventManagerProfileSync) {
      return;
    }

    try {
      await this.eventManagerProfileSync.notifyProfileUpdated(profile);
    } catch (error) {
      this.logger.warn('Failed to notify Event Manager about profile update', {
        userId: profile.keycloakId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async upsertLeanUser(profile: UserProfile): Promise<void> {
    const primaryEmail = profile.email.trim();
    if (!primaryEmail) {
      return;
    }

    try {
      await this.prisma.user.upsert({
        where: { keycloakId: profile.keycloakId },
        create: {
          keycloakId: profile.keycloakId,
          primaryEmail,
          primaryEmailNormalized: primaryEmail.toLowerCase(),
          displayName: profile.displayName || profile.fullname || null,
        },
        update: {
          primaryEmail,
          primaryEmailNormalized: primaryEmail.toLowerCase(),
          displayName: profile.displayName || profile.fullname || null,
        },
      });
    } catch (error) {
      this.logger.warn('Failed to sync lean user projection', {
        keycloakId: profile.keycloakId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private attributesToUserProfile(
    keycloakId: string,
    attributes: Record<string, string[]>,
    userBasicInfo?: { email: string; id: string },
  ): UserProfile {
    const getFirst = (key: string, defaultValue = ''): string => {
      return attributes[key]?.[0] || defaultValue;
    };

    const getBooleanFirst = (key: string, defaultValue = false): boolean => {
      const value = attributes[key]?.[0];
      return value ? value === 'true' : defaultValue;
    };

    const getDateFirst = (key: string, defaultValue: Date = new Date()): Date => {
      const value = attributes[key]?.[0];
      return value ? new Date(value) : defaultValue;
    };

    // Use email from attributes first, fallback to basic info
    const email = getFirst('email') || userBasicInfo?.email || '';
    const username = getFirst('username') || email;

    const pictureValue = getFirst('picture');
    this.logger.debug('Converting attributes to UserProfile', {
      userId: keycloakId,
      attributeCount: Object.keys(attributes).length,
    });

    return {
      id: keycloakId,
      username,
      email,
      secondaryEmails: this.parseStringList(attributes.secondary_emails),
      fullname: getFirst('fullName'), // Map from Keycloak's fullName to internal fullname
      displayName: getFirst('displayName') || email.split('@')[0],
      picture: pictureValue || undefined, // Google profile picture
      phone: getFirst('phone'),
      enrollmentNumber: attributes.enrollmentNumber?.[0] || undefined,
      identityDocument: getFirst('identity-document'), // Map from Keycloak's identity-document
      isForeigner: getBooleanFirst('isForeigner', false),
      passportCountry: getFirst('passportCountry') || undefined,
      isOnboarded: getBooleanFirst('isOnboarded', false),
      unespRole: (attributes.unespRole?.[0] as UnespRole) || undefined,
      unespRoleVerified: getBooleanFirst('unespRoleVerified', false),
      externalUserVerified: getBooleanFirst('externalUserVerified', false),
      fullNameLocked: getBooleanFirst('fullNameLocked', false),
      keycloakId,
      createdAt: getDateFirst('createdAt'),
      updatedAt: getDateFirst('updatedAt'),
    };
  }

  private parseStringList(values?: string[]): string[] {
    if (!values?.length) {
      return [];
    }

    return Array.from(
      new Set(
        values.flatMap((value) => {
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
        }),
      ),
    );
  }
}
