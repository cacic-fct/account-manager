const UNSAFE_ASCII_FILENAME_CHARACTERS = /["'();\\/]/g;

export function createAttachmentContentDisposition(fileName: string, fallbackFileName: string): string {
  const normalizedFileName = removeHeaderControlCharacters(fileName);
  const normalizedFallback = removeHeaderControlCharacters(fallbackFileName);
  const downloadFileName = normalizedFileName || normalizedFallback || 'download';
  const asciiFileName =
    downloadFileName
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(UNSAFE_ASCII_FILENAME_CHARACTERS, '_')
      .slice(0, 180)
      .trim() || 'download';
  const encodedFileName = encodeURIComponent(downloadFileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`;
}

function removeHeaderControlCharacters(value: string): string {
  return Array.from(value.normalize('NFKC'))
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join('')
    .trim();
}
