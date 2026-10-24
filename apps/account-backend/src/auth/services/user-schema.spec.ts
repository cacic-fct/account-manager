import * as schema from './user-schema';
import { UnespRole } from '../enums/unesp-role.enum';

const completedProfileAttributes = (): Record<string, string[]> => ({
  isOnboarded: ['true'],
  userSchemaVersion: [String(schema.REQUIRED_ONBOARDING_SCHEMA_VERSION)],
  fullName: ['User Test'],
  phone: ['+5514999999999'],
  'identity-document': ['12345678901'],
});

describe('User schema onboarding policy', () => {
  beforeEach(() => jest.replaceProperty(schema, 'REQUIRED_ONBOARDING_SCHEMA_VERSION', 1));
  afterEach(() => jest.restoreAllMocks());

  it.each([undefined, '', '0', '-1', '1.5', '1abc', '01', '9007199254740992'])(
    'requires review for an absent or invalid schema version (%s)',
    (version) => {
      const attributes = completedProfileAttributes();
      attributes.userSchemaVersion = version === undefined ? [] : [version];
      expect(schema.getUserOnboardingStatus(attributes)).toEqual({ needsOnboarding: true, missingFields: [] });
    },
  );

  it('preserves completed unversioned profiles when no onboarding revision is required', () => {
    jest.replaceProperty(schema, 'REQUIRED_ONBOARDING_SCHEMA_VERSION', 0);
    const attributes = completedProfileAttributes();
    delete attributes.userSchemaVersion;
    expect(schema.getUserOnboardingStatus(attributes).needsOnboarding).toBe(false);
  });

  it('keeps completed users onboarded after a compatible schema increment', () => {
    jest.replaceProperty(schema, 'CURRENT_USER_SCHEMA_VERSION', schema.REQUIRED_ONBOARDING_SCHEMA_VERSION + 1);
    expect(schema.getUserOnboardingStatus(completedProfileAttributes()).needsOnboarding).toBe(false);
  });

  it('requires review after the required schema threshold advances', () => {
    const attributes = completedProfileAttributes();
    jest.replaceProperty(schema, 'REQUIRED_ONBOARDING_SCHEMA_VERSION', schema.REQUIRED_ONBOARDING_SCHEMA_VERSION + 1);
    expect(schema.getUserOnboardingStatus(attributes)).toEqual({ needsOnboarding: true, missingFields: [] });
  });

  it('accepts newer completed versions during a rolling deployment or rollback', () => {
    const attributes = completedProfileAttributes();
    attributes.userSchemaVersion = [String(schema.CURRENT_USER_SCHEMA_VERSION + 1)];
    expect(schema.getUserOnboardingStatus(attributes).needsOnboarding).toBe(false);
  });

  it('does not promote an explicitly incomplete profile', () => {
    const attributes = completedProfileAttributes();
    attributes.isOnboarded = ['false'];
    expect(schema.getUserOnboardingStatus(attributes)).toEqual({ needsOnboarding: true, missingFields: [] });
  });

  it('checks conditional requirements even at the current version', () => {
    const attributes = completedProfileAttributes();
    attributes.isForeigner = ['true'];
    attributes.unespRole = [UnespRole.ALUNO_GRADUACAO];
    attributes.phone = ['  '];
    expect(schema.getUserOnboardingStatus(attributes)).toEqual({
      needsOnboarding: true,
      missingFields: ['phone', 'passportCountry', 'enrollmentNumber'],
    });
  });
});
