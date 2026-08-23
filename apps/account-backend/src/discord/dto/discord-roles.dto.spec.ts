import { validate } from 'class-validator';
import { UpdateRoleSelectionDto, UserRoleSelectionDto } from './discord-roles.dto';

describe('Discord role mutation DTOs', () => {
  it('rejects duplicate and malformed role snowflakes', async () => {
    const dto = Object.assign(new UserRoleSelectionDto(), {
      selectedRoleIds: ['12345678901234567', '12345678901234567', 'not-a-snowflake'],
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'selectedRoleIds' })]),
    );
  });

  it('bounds administrative role replacement arrays', async () => {
    const dto = Object.assign(new UpdateRoleSelectionDto(), {
      enabledRoleIds: Array.from({ length: 101 }, (_, index) => String(10_000_000_000_000_000n + BigInt(index))),
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'enabledRoleIds' })]),
    );
  });
});
