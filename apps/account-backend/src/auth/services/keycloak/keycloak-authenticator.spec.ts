import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const script = readFileSync(resolve(__dirname, '../../../../../../keycloak/user-creation.js'), 'utf8');

describe('Keycloak user creation authenticator', () => {
  function authenticate(
    options: { email?: string | null; name?: string | null; fullName?: string; missingUser?: boolean } = {},
  ) {
    const user = {
      getEmail: () => (options.email === undefined ? 'student@unesp.br' : options.email),
      getFirstName: () => (options.name === undefined ? 'Student' : options.name),
      getLastName: () => null,
      getFirstAttribute: () => options.fullName,
      setSingleAttribute: jest.fn(),
    };
    const context = { failure: jest.fn(), success: jest.fn() };
    const scope = {
      Java: { type: () => ({ INVALID_USER: 'INVALID_USER' }) },
      user: options.missingUser ? null : user,
      authenticate: jest.fn<void, [typeof context]>(),
    };
    runInNewContext(script, scope);
    scope.authenticate(context);
    return { context, user };
  }

  it.each([{ missingUser: true }, { email: null }])(
    'passes the required flow error for missing identity data',
    (options) => {
      const { context } = authenticate(options);
      expect(context.failure).toHaveBeenCalledWith('INVALID_USER');
      expect(context.success).not.toHaveBeenCalled();
    },
  );

  it('uses scalar attributes rather than relying on JS array to Java List conversion', () => {
    const { context, user } = authenticate({ email: 'Student@UNESP.BR' });
    expect(user.setSingleAttribute).toHaveBeenCalledWith('displayName', 'Student');
    expect(user.setSingleAttribute).toHaveBeenCalledWith('fullName', 'Student');
    expect(user.setSingleAttribute).toHaveBeenCalledWith('unesp_email', 'Student@UNESP.BR');
    expect(context.success).toHaveBeenCalledTimes(1);
  });

  it('preserves an existing full name on subsequent authentication', () => {
    const { user } = authenticate({ fullName: 'Verified Student Name' });
    expect(user.setSingleAttribute).not.toHaveBeenCalledWith('fullName', expect.anything());
  });

  it('does not turn a missing name into a literal null string', () => {
    const { user } = authenticate({ name: null, email: 'student@example.test' });
    expect(user.setSingleAttribute).toHaveBeenCalledWith('displayName', '');
    expect(user.setSingleAttribute).not.toHaveBeenCalledWith('unesp_email', expect.anything());
  });
});
