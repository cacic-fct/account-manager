export function getDiscordAvatarUrl(
  userId: string,
  avatarHash?: string | null,
  size = 128,
): string {
  if (avatarHash) {
    const extension = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${extension}?size=${size}`;
  }

  const discriminator = (BigInt(userId) >> BigInt(22)) % BigInt(6);
  return `https://cdn.discordapp.com/embed/avatars/${discriminator}.png?size=${size}`;
}

export function isAnimatedAvatar(avatarHash?: string | null): boolean {
  return avatarHash?.startsWith('a_') ?? false;
}
