import { Injectable, BadRequestException } from '@nestjs/common';

/**
 * Service to validate file uploads and provide security checks
 */
@Injectable()
export class FileValidationService {
  private readonly ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
  ];

  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  /**
   * Validate uploaded file for security and business rules
   */
  validateFile(file: Express.Multer.File, allowTextFiles = false): void {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado.');
    }

    // Check file size
    if (file.size > this.MAX_FILE_SIZE) {
      throw new BadRequestException(
        `Arquivo muito grande. Tamanho máximo permitido: ${this.MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }

    // Check MIME type
    const allowedTypes = [...this.ALLOWED_MIME_TYPES];

    // Allow text files for manual fallback in development
    if (allowTextFiles && process.env.NODE_ENV === 'development') {
      allowedTypes.push('text/plain');
    }

    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Tipo de arquivo não permitido. Tipos aceitos: ${allowedTypes.join(', ')}`,
      );
    }

    // Additional security checks
    this.performSecurityChecks(file);
  }

  /**
   * Perform additional security checks on the file
   */
  private performSecurityChecks(file: Express.Multer.File): void {
    // Check for potentially dangerous filenames
    if (this.containsSuspiciousFilename(file.originalname)) {
      throw new BadRequestException(
        'Nome do arquivo contém caracteres não permitidos.',
      );
    }

    // Check file header (magic bytes) matches MIME type for basic validation
    if (!this.validateFileHeader(file)) {
      throw new BadRequestException(
        'Arquivo não corresponde ao tipo declarado.',
      );
    }
  }

  /**
   * Check if filename contains suspicious patterns
   */
  private containsSuspiciousFilename(filename: string): boolean {
    const suspiciousPatterns = [
      /\.\./, // Directory traversal
      /[<>:"|?*]/, // Invalid filename characters
      /^\./, // Hidden files
      /\.php$/i, // PHP files
      /\.js$/i, // JavaScript files
      /\.html?$/i, // HTML files
      /\.exe$/i, // Executable files
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(filename));
  }

  /**
   * Basic file header validation - checks magic bytes
   */
  private validateFileHeader(file: Express.Multer.File): boolean {
    const buffer = file.buffer;
    if (!buffer || buffer.length < 4) {
      return false;
    }

    // Common file signatures (magic bytes)
    const signatures = {
      'application/pdf': [0x25, 0x50, 0x44, 0x46], // %PDF
      'image/jpeg': [0xff, 0xd8, 0xff], // JPEG
      'image/png': [0x89, 0x50, 0x4e, 0x47], // PNG
    };

    const signature = signatures[file.mimetype as keyof typeof signatures];
    if (!signature) {
      // If we don't have a signature for this type, skip validation
      return true;
    }

    // Check if file starts with the expected signature
    for (let i = 0; i < signature.length; i++) {
      if (buffer[i] !== signature[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Sanitize filename for safe storage
   */
  sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^\w\s.-]/g, '') // Remove special characters except word chars, spaces, dots, dashes
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 255); // Limit length
  }
}
