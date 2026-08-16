import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  TextContent,
  TextItem,
} from 'pdfjs-dist/types/src/display/api';

// PDF.js for Node.js
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

@Injectable()
export class PdfProcessingService {
  private readonly logger = new Logger(PdfProcessingService.name);

  /**
   * Extract text from PDF using PDF.js
   */
  private async extractTextFromPdf(pdfBuffer: Buffer): Promise<string | null> {
    let loadingTask: PDFDocumentLoadingTask | undefined;
    try {
      this.logger.debug('Starting PDF text extraction with PDF.js', {
        bufferSize: pdfBuffer.length,
      });

      // pdfjs-dist's .mjs entry point is not typed by the package export map.
      // Keep the unsafe boundary here and use its published API types below.
      loadingTask = getDocument({
        data: new Uint8Array(pdfBuffer),
        verbosity: 0,
      });
      const activeLoadingTask = loadingTask;

      const pdfDocument: PDFDocumentProxy = await this.withTimeout(
        activeLoadingTask.promise,
        10_000,
        'Tempo limite ao processar o PDF.',
        () => activeLoadingTask.destroy(),
      );
      let fullText = '';

      if (pdfDocument.numPages > 20) {
        throw new BadRequestException('O PDF excede o limite de 20 páginas.');
      }

      this.logger.debug('PDF document loaded successfully', {
        numPages: pdfDocument.numPages,
      });

      // Extract text from all pages
      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        try {
          const page: PDFPageProxy = await this.withTimeout(
            pdfDocument.getPage(pageNum),
            3_000,
            'Tempo limite ao processar uma página do PDF.',
          );
          const textContent: TextContent = await this.withTimeout(
            page.getTextContent({ includeMarkedContent: true }),
            3_000,
            'Tempo limite ao extrair texto do PDF.',
          );

          this.logger.debug(`Processing page ${pageNum}`, {
            textItemsCount: textContent.items.length,
          });

          if (textContent.items.length === 0) {
            this.logger.warn(`Page ${pageNum} has no text items - this suggests a scanned/image-based PDF`);
          }

          const pageText = textContent.items
            .map((item) => {
              const textItem = item as TextItem;
              return typeof textItem.str === 'string' ? textItem.str : '';
            })
            .filter((str) => str.length > 0)
            .join(' ');

          if (pageText.trim().length > 0) {
            this.logger.debug(`Page ${pageNum} text extracted successfully`, {
              pageTextLength: pageText.length,
            });
          } else {
            this.logger.warn(`Page ${pageNum} yielded no extractable text`);
          }

          fullText += pageText + '\n';
          if (fullText.length > 1024 * 1024) {
            throw new BadRequestException('O conteúdo textual do PDF excede o limite permitido.');
          }
        } catch (pageError) {
          if (pageError instanceof BadRequestException) {
            throw pageError;
          }
          this.logger.error(`Error processing page ${pageNum}`);
          throw new BadRequestException('Não foi possível processar todas as páginas do PDF.');
        }
      }

      const finalText = fullText.trim();
      this.logger.debug('PDF text extraction completed', {
        totalTextLength: finalText.length,
      });

      if (finalText.length === 0) {
        this.logger.warn(
          'PDF.js text extraction resulted in empty text - this might be a scanned/image-based PDF or have compatibility issues with PDF.js',
          {
            documentPages: pdfDocument.numPages,
            suggestion: 'Will fall back to buffer-based text extraction in calling methods',
          },
        );
        // Return null instead of throwing exception to allow fallback methods
        return null;
      }

      return finalText;
    } catch (error) {
      this.logger.error('Error extracting text from PDF with PDF.js:', error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException('Erro ao processar arquivo PDF. Verifique se o arquivo é um PDF válido.');
    } finally {
      await loadingTask?.destroy().catch(() => undefined);
    }
  }

  /**
   * Extract authentication code from PDF buffer
   */
  async extractAuthCodeFromPdf(pdfBuffer: Buffer): Promise<string> {
    try {
      this.logger.debug('Extracting authentication code from PDF');
      const pdfText = await this.extractTextFromPdf(pdfBuffer);

      // If PDF.js failed, fall back to simple extraction
      if (pdfText === null) {
        this.logger.debug('PDF.js failed, trying simple buffer extraction for auth code');
        return this.extractAuthCodeFromPdfSimple(pdfBuffer);
      }

      // Look for the correct authentication code pattern
      // Format: "Código de autenticidade:\nAAA8-A085-E755-57EE-F6CA-BD0B-2ABC-29B4"
      const codeMatch = pdfText.match(/Código de autenticidade:\s*((?:[A-F0-9]{4}-){7}[A-F0-9]{4})(?![A-F0-9-])/i);
      if (codeMatch && codeMatch[1]) {
        this.logger.debug('Found authentication code in PDF');
        return codeMatch[1];
      }

      // Alternative patterns for different document formats
      const altPatterns = [
        // More flexible pattern for authentication code
        /Código de autenticidade[:\s]*((?:[A-F0-9]{4}-){7}[A-F0-9]{4})(?![A-F0-9-])/i,
        /Código de Autenticação:\s*((?:[A-F0-9]{4}-){7}[A-F0-9]{4})(?![A-F0-9-])/i,
        /Authentication Code:\s*((?:[A-F0-9]{4}-){7}[A-F0-9]{4})(?![A-F0-9-])/i,
      ];

      for (const pattern of altPatterns) {
        const match = pdfText.match(pattern);
        if (match && match[1]) {
          this.logger.debug('Found authentication code with alternative PDF pattern');
          return match[1];
        }
      }

      this.logger.error('Authentication code not found in PDF');
      throw new BadRequestException(
        'Código de autenticidade não encontrado no PDF. Verifique se o documento é válido e contém um código de autenticidade.',
      );
    } catch (error) {
      this.logger.error('Error extracting authentication code from PDF:', error);
      // If it's already a BadRequestException, re-throw it
      if (error instanceof BadRequestException) {
        throw error;
      }
      // For other errors (PDF processing errors), throw as BadRequestException too
      throw new BadRequestException('Erro ao processar arquivo PDF. Verifique se o arquivo é um PDF válido.');
    }
  }

  /**
   * Extract authentication code from PDF using simple buffer-to-string conversion
   */
  private extractAuthCodeFromPdfSimple(pdfBuffer: Buffer): string {
    try {
      // Convert buffer to text using multiple encodings
      const encodings = ['latin1', 'utf8'];

      for (const encoding of encodings) {
        try {
          const pdfText = pdfBuffer.toString(encoding as BufferEncoding);

          // Look for the correct authentication code pattern
          const codeMatch = pdfText.match(/Código de autenticidade:\s*((?:[A-F0-9]{4}-){7}[A-F0-9]{4})(?![A-F0-9-])/i);
          if (codeMatch && codeMatch[1]) {
            this.logger.debug(`Found authentication code using ${encoding} encoding fallback`);
            return codeMatch[1];
          }

          // Alternative patterns for different document formats
          const altPatterns = [
            // More flexible pattern for authentication code
            /Código de autenticidade[:\s]*((?:[A-F0-9]{4}-){7}[A-F0-9]{4})(?![A-F0-9-])/i,
            /Código de Autenticação:\s*((?:[A-F0-9]{4}-){7}[A-F0-9]{4})(?![A-F0-9-])/i,
            /Authentication Code:\s*((?:[A-F0-9]{4}-){7}[A-F0-9]{4})(?![A-F0-9-])/i,
          ];

          for (const pattern of altPatterns) {
            const match = pdfText.match(pattern);
            if (match && match[1]) {
              this.logger.debug(`Found authentication code using alternative ${encoding} encoding fallback`);
              return match[1];
            }
          }
        } catch (error) {
          this.logger.debug(`Failed to decode PDF with ${encoding} encoding for auth code:`, error);
        }
      }

      this.logger.error('Authentication code not found in PDF using fallback method');
      throw new BadRequestException(
        'Código de autenticidade não encontrado no PDF. Verifique se o documento é válido e contém um código de autenticidade.',
      );
    } catch (error) {
      this.logger.error('Error in auth code fallback extraction:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Erro ao processar arquivo PDF. Verifique se o arquivo é um PDF válido.');
    }
  }

  /**
   * Extract enrollment number from PDF using PDF.js
   */
  async extractEnrollmentFromPdf(pdfBuffer: Buffer, fallbackToSimple = true): Promise<string | null> {
    try {
      this.logger.debug('Extracting enrollment number from PDF using PDF.js');
      const pdfText = await this.extractTextFromPdf(pdfBuffer);

      // If PDF.js failed, fall back to simple extraction
      if (pdfText === null) {
        this.logger.debug('PDF.js failed for enrollment, falling back to simple extraction method');
        if (fallbackToSimple) {
          return this.extractEnrollmentFromPdfSimple(pdfBuffer);
        }
        return null;
      }

      this.logger.debug('PDF parsed successfully, text length:', pdfText.length);

      // Look for common enrollment patterns
      const patterns = [
        /RA\s*n[ºo°]?\s*(\d{5,20})/i,
        /Registro\s+Acad[eê]mico\s*:?\s*(\d{5,20})/i,
        /R\.A\.?\s*:?\s*(\d{5,20})/i,
        /matr[íi]cula\s*:?\s*(\d{5,20})/i,
      ];

      for (const pattern of patterns) {
        const match = pdfText.match(pattern);
        if (match && match[1]) {
          this.logger.debug('Found a valid enrollment number in PDF');
          return this.isValidEnrollment(match[1]) ? match[1] : null;
        }
      }

      this.logger.debug('No enrollment number found using PDF.js');

      // Fallback to simple extraction if enabled
      if (fallbackToSimple) {
        this.logger.debug('Falling back to simple extraction method');
        return this.extractEnrollmentFromPdfSimple(pdfBuffer);
      }

      return null;
    } catch (error) {
      this.logger.error('Error parsing PDF with PDF.js:', error);

      // Fallback to simple extraction if enabled
      if (fallbackToSimple) {
        this.logger.debug('Falling back to simple extraction method due to error');
        return this.extractEnrollmentFromPdfSimple(pdfBuffer);
      }

      return null;
    }
  }

  /**
   * Extract enrollment number from PDF using simple buffer-to-string conversion
   */
  private extractEnrollmentFromPdfSimple(pdfBuffer: Buffer): string | null {
    try {
      // Convert buffer to text using multiple encodings
      const encodings = ['latin1', 'utf8'];

      for (const encoding of encodings) {
        try {
          const pdfText = pdfBuffer.toString(encoding as BufferEncoding);

          // Look for common enrollment patterns
          const patterns = [
            /RA\s*n[ºo°]?\s*(\d{5,20})/i,
            /Registro\s+Acad[eê]mico\s*:?\s*(\d{5,20})/i,
            /R\.A\.?\s*:?\s*(\d{5,20})/i,
            /matr[íi]cula\s*:?\s*(\d{5,20})/i,
          ];

          for (const pattern of patterns) {
            const match = pdfText.match(pattern);
            if (match && match[1]) {
              this.logger.debug(`Found a valid enrollment number using ${encoding} fallback`);
              return this.isValidEnrollment(match[1]) ? match[1] : null;
            }
          }
        } catch (error) {
          this.logger.debug(`Failed to decode PDF with ${encoding} encoding:`, error);
        }
      }

      this.logger.debug('No enrollment number found in PDF content');
      return null;
    } catch (error) {
      this.logger.error('Error extracting enrollment from PDF:', error);
      return null;
    }
  }

  /**
   * Check if enrollment number exists in PDF content
   */
  async checkEnrollmentInPdf(pdfBuffer: Buffer, enrollmentNumber: string): Promise<boolean> {
    if (!this.isValidEnrollment(enrollmentNumber)) {
      this.logger.warn('Rejected invalid enrollment value before PDF comparison');
      return false;
    }

    try {
      this.logger.debug('Checking enrollment number in PDF using PDF.js');
      // Use PDF.js to properly extract text from PDF
      const pdfText = await this.extractTextFromPdf(pdfBuffer);

      // If PDF.js failed, fall back to simple buffer method
      if (pdfText === null) {
        this.logger.debug('PDF.js failed for enrollment check, falling back to simple buffer method');
        return this.checkEnrollmentInPdfFallback(pdfBuffer, enrollmentNumber);
      }

      this.logger.debug('Checking enrollment in PDF', { pdfTextLength: pdfText.length });

      // Check for exact match and some variations
      const withoutLeadingZeros = enrollmentNumber.replace(/^0+(?=\d)/, '');
      const variations = [
        enrollmentNumber,
        withoutLeadingZeros,
        `0${enrollmentNumber}`, // Add leading zero
        enrollmentNumber.replace(/(\d{4})(\d{4})/, '$1.$2'), // Add dot separator
        enrollmentNumber.replace(/(\d{4})(\d{4})/, '$1-$2'), // Add dash separator
      ];

      for (const variation of variations) {
        if (pdfText.includes(variation)) {
          this.logger.debug('Enrollment number matched PDF content');
          return true;
        }
      }

      // Also try with regex patterns for more flexible matching
      const patterns = [
        new RegExp(`\\b${enrollmentNumber}\\b`, 'i'),
        new RegExp(`\\b${withoutLeadingZeros}\\b`, 'i'),
        new RegExp(`\\b0*${enrollmentNumber}\\b`, 'i'),
      ];

      for (const pattern of patterns) {
        if (pattern.test(pdfText)) {
          this.logger.debug(`Found enrollment number using pattern ${pattern} in PDF`);
          return true;
        }
      }

      this.logger.debug('Enrollment number did not match PDF content');
      return false;
    } catch (error) {
      this.logger.error('Error checking enrollment in PDF:', error);

      // Fallback to simple buffer method if PDF.js fails
      this.logger.debug('Falling back to simple buffer method for enrollment check');
      return this.checkEnrollmentInPdfFallback(pdfBuffer, enrollmentNumber);
    }
  }

  /**
   * Fallback method for enrollment checking using raw buffer
   */
  private checkEnrollmentInPdfFallback(pdfBuffer: Buffer, enrollmentNumber: string): boolean {
    if (!this.isValidEnrollment(enrollmentNumber)) {
      return false;
    }

    try {
      // Convert buffer to text using multiple encodings
      const encodings = ['latin1', 'utf8'];

      for (const encoding of encodings) {
        try {
          const pdfText = pdfBuffer.toString(encoding as BufferEncoding);

          // Check for exact match and some variations
          const variations = [
            enrollmentNumber,
            enrollmentNumber.replace(/^0+(?=\d)/, ''),
            `0${enrollmentNumber}`, // Add leading zero
          ];

          for (const variation of variations) {
            if (pdfText.includes(variation)) {
              this.logger.debug(`Enrollment number matched using ${encoding} fallback`);
              return true;
            }
          }
        } catch (error) {
          this.logger.debug(`Failed to decode PDF with ${encoding} encoding:`, error);
        }
      }

      return false;
    } catch (error) {
      this.logger.error('Error in enrollment fallback check:', error);
      return false;
    }
  }

  /**
   * Check if fullname exists in PDF content
   */
  async checkFullnameInPdf(pdfBuffer: Buffer, expectedFullname: string): Promise<boolean> {
    const normalizedExpectedInput = this.normalizeNameForMatching(expectedFullname);
    if (normalizedExpectedInput.length < 5 || normalizedExpectedInput.split(' ').filter(Boolean).length < 2) {
      this.logger.warn('Rejected empty or incomplete full name before PDF comparison');
      return false;
    }

    try {
      this.logger.debug('Checking full name in PDF using PDF.js');

      // Use PDF.js to properly extract text from PDF
      const pdfText = await this.extractTextFromPdf(pdfBuffer);

      // If PDF.js failed, fall back to simple buffer method
      if (pdfText === null) {
        this.logger.debug('PDF.js failed for fullname check, falling back to simple buffer method');
        return this.checkFullnameInPdfFallback(pdfBuffer, expectedFullname);
      }

      this.logger.debug('Checking full name in PDF', { pdfTextLength: pdfText.length });

      // Look for specific name patterns in Unesp documents
      // Pattern 1: "Nome do Aluno Full Name Registro"
      // Pattern 2: "que Full Name,"
      const namePatterns = [/Nome do Aluno\s+(.+?)\s+Registro/i, /que\s+([^,]+),/i];

      let extractedName = '';
      for (const pattern of namePatterns) {
        const match = pdfText.match(pattern);
        if (match && match[1]) {
          extractedName = match[1].trim();
          this.logger.debug('Found a name using a known PDF pattern');
          break;
        }
      }

      if (!extractedName) {
        this.logger.warn('Could not extract name from PDF using known patterns');
        // Fallback to old method if no specific pattern is found
        return this.checkFullnameInPdfFallback(pdfBuffer, expectedFullname);
      }

      // Normalize both names for comparison
      const normalizedExpected = this.normalizeNameForMatching(expectedFullname);
      const normalizedExtracted = this.normalizeNameForMatching(extractedName);

      // Check for exact match first
      if (normalizedExtracted === normalizedExpected) {
        this.logger.debug('Exact fullname match found');
        return true;
      }

      this.logger.warn('Full name from the profile does not exactly match the university document');
      return false;
    } catch (error) {
      this.logger.error('Error checking fullname in PDF with PDF.js:', error);

      // Fallback to simple buffer method if PDF.js fails
      this.logger.debug('Falling back to simple buffer method for fullname check');
      return this.checkFullnameInPdfFallback(pdfBuffer, expectedFullname);
    }
  }

  /**
   * Fallback method for fullname checking using raw buffer
   */
  private checkFullnameInPdfFallback(pdfBuffer: Buffer, expectedFullname: string): boolean {
    try {
      // Convert buffer to text using multiple encodings
      const encodings = ['latin1', 'utf8'];

      // Normalize the expected fullname for better matching
      const normalizedExpected = this.normalizeNameForMatching(expectedFullname);
      if (normalizedExpected.length < 5 || normalizedExpected.split(' ').filter(Boolean).length < 2) {
        return false;
      }

      this.logger.debug('Checking full name using buffer fallback');

      for (const encoding of encodings) {
        try {
          const pdfText = pdfBuffer.toString(encoding as BufferEncoding);
          const normalizedPdfText = this.normalizeNameForMatching(pdfText);

          // Check for exact match first
          if (` ${normalizedPdfText} `.includes(` ${normalizedExpected} `)) {
            this.logger.debug(`Full name matched using ${encoding} fallback`);
            return true;
          }
        } catch (error) {
          this.logger.debug(`Failed to decode PDF with ${encoding} encoding:`, error);
        }
      }

      this.logger.warn('Full name did not match PDF content using fallback method');
      return false;
    } catch (error) {
      this.logger.error('Error in fullname fallback check:', error);
      return false;
    }
  }

  private isValidEnrollment(value: string): boolean {
    return /^\d{5,20}$/.test(value) && /[1-9]/.test(value);
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
    onTimeout?: () => void | Promise<void>,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            void onTimeout?.();
            reject(new BadRequestException(message));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Normalize text for better name matching
   */
  private normalizeNameForMatching(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD') // Decompose accented characters
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^a-z0-9\s]/g, ' ') // Replace non-alphanumeric with spaces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Extract name from PDF document
   */
  async extractNameFromPdf(pdfBuffer: Buffer): Promise<string | null> {
    try {
      this.logger.debug('Extracting name from PDF using PDF.js');
      const pdfText = await this.extractTextFromPdf(pdfBuffer);

      // If PDF.js failed, fall back to simple extraction
      if (pdfText === null) {
        this.logger.debug('PDF.js failed, trying simple buffer extraction for name');
        return this.extractNameFromPdfSimple(pdfBuffer);
      }

      this.logger.debug('Extracting name from PDF', { pdfTextLength: pdfText.length });

      // Pattern 1: "Nome do Aluno Full Name Registro"
      // Pattern 2: "que Full Name,"
      const namePatterns = [
        /Nome do Aluno\s+(.+?)\s+Registro/i,
        /que\s+([^,]+),/i,
        /Nome:\s*([^\n\r]+)/i,
        /NOME:\s*([^\n\r]+)/i,
        /Aluno:\s*([^\n\r]+)/i,
        /ALUNO:\s*([^\n\r]+)/i,
      ];

      for (const pattern of namePatterns) {
        const match = pdfText.match(pattern);
        if (match && match[1]) {
          const extractedName = match[1].trim();
          this.logger.debug('Found a name using a known PDF pattern');
          return extractedName;
        }
      }

      this.logger.debug('No name found using PDF.js patterns, trying simple method');
      return this.extractNameFromPdfSimple(pdfBuffer);
    } catch (error) {
      this.logger.error('Error extracting name from PDF:', error);
      return this.extractNameFromPdfSimple(pdfBuffer);
    }
  }

  /**
   * Extract name from PDF using simple buffer-to-string conversion
   */
  private extractNameFromPdfSimple(pdfBuffer: Buffer): string | null {
    try {
      const encodings = ['latin1', 'utf8'];

      for (const encoding of encodings) {
        try {
          const pdfText = pdfBuffer.toString(encoding as BufferEncoding);

          // Same patterns as above
          const namePatterns = [
            /Nome do Aluno\s+(.+?)\s+Registro/i,
            /que\s+([^,]+),/i,
            /Nome:\s*([^\n\r]+)/i,
            /NOME:\s*([^\n\r]+)/i,
            /Aluno:\s*([^\n\r]+)/i,
            /ALUNO:\s*([^\n\r]+)/i,
          ];

          for (const pattern of namePatterns) {
            const match = pdfText.match(pattern);
            if (match && match[1]) {
              const extractedName = match[1].trim();
              this.logger.debug(`Found a name using ${encoding} fallback`);
              return extractedName;
            }
          }
        } catch (error) {
          this.logger.debug(`Failed to decode PDF with ${encoding} encoding:`, error);
        }
      }

      this.logger.debug('No name found in PDF content using simple method');
      return null;
    } catch (error) {
      this.logger.error('Error extracting name from PDF (simple method):', error);
      return null;
    }
  }

  /**
   * Extract filename from Content-Disposition header
   */
  extractFilenameFromContentDisposition(headers: Record<string, string | string[] | undefined>): string | null {
    const contentDisposition = headers['content-disposition'] as string;
    if (!contentDisposition) {
      return null;
    }

    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).?\2|[^;\n]*)/);
    return filenameMatch ? filenameMatch[1].replace(/['"]/g, '') : null;
  }

  /**
   * Test method to verify authentication code extraction
   */
  testAuthCodeExtraction(sampleText: string): string | null {
    try {
      // Test the same patterns used in extractAuthCodeFromPdf
      const codeMatch = sampleText.match(/Código de autenticidade:\s*((?:[A-F0-9]{4}-){7}[A-F0-9]{4})(?![A-F0-9-])/i);
      if (codeMatch && codeMatch[1]) {
        this.logger.debug('Test found authentication code');
        return codeMatch[1];
      }

      // Alternative patterns
      const altPatterns = [
        /Código de autenticidade[:\s]*((?:[A-F0-9]{4}-){7}[A-F0-9]{4})(?![A-F0-9-])/i,
        /Código de Autenticação:\s*((?:[A-F0-9]{4}-){7}[A-F0-9]{4})(?![A-F0-9-])/i,
        /Authentication Code:\s*((?:[A-F0-9]{4}-){7}[A-F0-9]{4})(?![A-F0-9-])/i,
      ];

      for (const pattern of altPatterns) {
        const match = sampleText.match(pattern);
        if (match && match[1]) {
          this.logger.debug('Test found authentication code with alternative pattern');
          return match[1];
        }
      }

      this.logger.debug('Test: Authentication code not found in sample text');
      return null;
    } catch (error) {
      this.logger.error('Error in test authentication code extraction:', error);
      return null;
    }
  }
}
