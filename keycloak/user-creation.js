var AuthenticationFlowError = Java.type('org.keycloak.authentication.AuthenticationFlowError');

function authenticate(context) {
  if (!user) {
    context.failure(AuthenticationFlowError.INVALID_USER);
    return;
  }

  var email = user.getEmail();
  if (!email) {
    context.failure(AuthenticationFlowError.INVALID_USER);
    return;
  }

  var displayName = [user.getFirstName() || '', user.getLastName() || ''].join(' ').trim();

  // Store display name for all users
  user.setSingleAttribute('displayName', displayName);

  // Special handling for Unesp users
  if (String(email).toLowerCase().endsWith('@unesp.br')) {
    if (!user.getFirstAttribute('fullName')) {
      user.setSingleAttribute('fullName', displayName);
    }
    user.setSingleAttribute('unesp_email', email);
  }

  context.success();
}
