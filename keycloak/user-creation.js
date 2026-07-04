function authenticate(context) {
  LOG.error('User creation script started' + user);

  var email = user.getEmail();
  if (!email) {
    context.failure();
    return;
  }

  var displayName = user.getFirstName() + ' ' + user.getLastName();

  // Always store the profile picture if available
  var picture = user.getAttribute('picture');
  if (picture && picture.length > 0) {
    user.setAttribute('picture', [picture[0]]);
  }

  // Store display name for all users
  user.setAttribute('displayName', [displayName]);

  // Special handling for Unesp users
  if (email.endsWith('@unesp.br')) {
    user.setAttribute('fullName', [displayName]);
    user.setAttribute('unesp_email', [email]);
  }

  context.success();
}
