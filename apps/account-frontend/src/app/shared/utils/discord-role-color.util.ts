export function normalizeDiscordRoleColor(
  color: string | null | undefined,
): string {
  const trimmed = color?.trim();

  if (!trimmed || trimmed === '#000000') {
    return '#99aab5';
  }

  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, red, green, blue] = trimmed;
    return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase();
  }

  return '#99aab5';
}

export function getReadableDiscordRoleTextColor(
  color: string | null | undefined,
): '#000000' | '#ffffff' {
  const luminance = getRelativeLuminance(normalizeDiscordRoleColor(color));
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);

  return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
}

function getRelativeLuminance(color: string): number {
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);

  const [linearRed, linearGreen, linearBlue] = [red, green, blue].map(
    (channel) => {
      const value = channel / 255;
      return value <= 0.03928
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    },
  );

  return 0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue;
}
