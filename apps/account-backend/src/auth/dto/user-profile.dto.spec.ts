import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserProfileDto } from './user-profile.dto';

const validProfile = {
  fullname: 'Ana Example',
  phone: '+5514999999999',
  identityDocument: '12345678901',
  isForeigner: false,
};

describe(CreateUserProfileDto.name, () => {
  it('requires and normalizes an ISO passport country for foreign users', async () => {
    const valid = plainToInstance(CreateUserProfileDto, {
      ...validProfile,
      identityDocument: 'P1234567',
      isForeigner: true,
      passportCountry: ' ar ',
    });
    const missing = plainToInstance(CreateUserProfileDto, {
      ...validProfile,
      identityDocument: 'P1234567',
      isForeigner: true,
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.passportCountry).toBe('AR');
    await expect(validate(missing)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'passportCountry' })]),
    );
  });

  it.each([
    ['fullname', 'a'.repeat(201)],
    ['phone', '1'.repeat(33)],
    ['identityDocument', 'x'.repeat(65)],
    ['enrollmentNumber', '1'.repeat(65)],
  ])('rejects oversized %s input', async (field, value) => {
    const profile = plainToInstance(CreateUserProfileDto, {
      ...validProfile,
      [field]: value,
    });

    await expect(validate(profile)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: field })]),
    );
  });
});
