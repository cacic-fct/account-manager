/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

// PDF.js for Node.js
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

@Injectable()
export class PdfProcessingService {
  private readonly logger = new Logger(PdfProcessingService.name);

  /**
   * Extract text from PDF using PDF.js
   */
  private async extractTextFromPdf(pdfBuffer: Buffer): Promise<string | null> {
    try {
      this.logger.debug('Starting PDF text extraction with PDF.js', {
        bufferSize: pdfBuffer.length,
        bufferStart: pdfBuffer.subarray(0, 10).toString('hex'),
      });

      // Load the PDF document
      const loadingTask = getDocument({
        data: new Uint8Array(pdfBuffer),
        verbosity: 0, // Suppress console logs
      });

      const pdfDocument = await loadingTask.promise;
      let fullText = '';

      this.logger.debug('PDF document loaded successfully', {
        numPages: pdfDocument.numPages,
      });

      // Extract text from all pages
      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        try {
          const page = await pdfDocument.getPage(pageNum);

          // Get detailed page information
          const pageInfo = await page.getViewport({ scale: 1.0 });
          this.logger.debug(`Page ${pageNum} info`, {
            width: pageInfo.width,
            height: pageInfo.height,
            rotation: pageInfo.rotation,
          });

          // Try to get text content with different options
          let textContent;
          try {
            textContent = await page.getTextContent({
              includeMarkedContent: true,
            });
          } catch (textError) {
            this.logger.warn(
              `Failed to get text content with options for page ${pageNum}, trying basic method:`,
              textError,
            );
            textContent = await page.getTextContent();
          }

          this.logger.debug(`Processing page ${pageNum}`, {
            textItemsCount: textContent.items.length,
            hasStyles: 'styles' in textContent,
            stylesCount: textContent.styles
              ? Object.keys(textContent.styles as object).length
              : 0,
          });

          // Check if this might be an image-based PDF by looking for images
          try {
            const operatorList = await page.getOperatorList();
            const hasImages = operatorList.fnArray.some(
              (fn: number) => fn === 74 || fn === 75 || fn === 76, // Image operator codes in PDF.js
            );
            this.logger.debug(`Page ${pageNum} contains images: ${hasImages}`);

            if (hasImages && textContent.items.length === 0) {
              this.logger.warn(
                `Page ${pageNum} appears to be image-based (scanned PDF) - no text items but contains images`,
              );
            }
          } catch (opError) {
            this.logger.debug(
              `Could not analyze operators for page ${pageNum}:`,
              opError,
            );
          }

          // Log detailed information about text content structure
          if (textContent.items.length > 0) {
            const sampleItems = textContent.items
              .slice(0, 3)
              .map((item, index: number) => ({
                index,
                str: (item as TextItem)?.str,
                strType: typeof (item as TextItem)?.str,
                strLength: (item as TextItem)?.str?.length || 0,
                hasEOL: 'hasEOL' in item,
                transform: (item as TextItem)?.transform,
                width: (item as TextItem)?.width,
                height: (item as TextItem)?.height,
                itemKeys: item ? Object.keys(item as object) : [],
                fullItem: item, // Include full item for debugging
              }));
            this.logger.debug(
              `Sample text items from page ${pageNum}:`,
              sampleItems,
            );
          } else {
            this.logger.warn(
              `Page ${pageNum} has no text items - this suggests a scanned/image-based PDF`,
            );
          }

          // Try different text extraction approaches
          let pageText = '';

          // Method 1: Standard text extraction
          pageText = textContent.items
            .map((item) => {
              const textItem = item as TextItem;
              if (textItem && typeof textItem.str === 'string') {
                return textItem.str;
              }
              return '';
            })
            .filter((str) => str.length > 0)
            .join(' ');

          // Method 2: If no text, try to extract from styles or other properties
          if (pageText.trim().length === 0 && textContent.items.length > 0) {
            this.logger.debug(
              `Trying alternative text extraction for page ${pageNum}`,
            );

            pageText = textContent.items
              .map((item) => {
                const textItem = item as TextItem;
                // Use the standard str property from TextItem
                return textItem?.str || '';
              })
              .filter((str) => str && str.length > 0)
              .join(' ');
          }

          if (pageText.trim().length > 0) {
            this.logger.debug(`Page ${pageNum} text extracted successfully`, {
              pageTextLength: pageText.length,
              pageTextPreview: pageText.substring(0, 150),
            });
          } else {
            this.logger.warn(`Page ${pageNum} yielded no extractable text`, {
              textItemsCount: textContent.items.length,
              possibleCause:
                textContent.items.length === 0
                  ? 'No text items found - likely a scanned/image-based PDF'
                  : 'Text items found but no readable text content',
            });
          }

          fullText += pageText + '\n';
        } catch (pageError) {
          this.logger.error(`Error processing page ${pageNum}:`, pageError);
          // Continue with other pages
        }
      }

      await pdfDocument.destroy();

      const finalText = fullText.trim();
      this.logger.debug('PDF text extraction completed', {
        totalTextLength: finalText.length,
        textPreview: finalText.substring(0, 200),
      });

      if (finalText.length === 0) {
        this.logger.warn(
          'PDF.js text extraction resulted in empty text - this might be a scanned/image-based PDF or have compatibility issues with PDF.js',
          {
            documentPages: pdfDocument.numPages,
            suggestion:
              'Will fall back to buffer-based text extraction in calling methods',
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

      throw new BadRequestException(
        'Erro ao processar arquivo PDF. Verifique se o arquivo é um PDF válido.',
      );
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
        this.logger.debug(
          'PDF.js failed, trying simple buffer extraction for auth code',
        );
        return this.extractAuthCodeFromPdfSimple(pdfBuffer);
      }

      this.logger.debug('PDF Text Preview:', pdfText);

      // Look for the correct authentication code pattern
      // Format: "Código de autenticidade:\nAAA8-A085-E755-57EE-F6CA-BD0B-2ABC-29B4"
      const codeMatch = pdfText.match(
        /Código de autenticidade:\s*([A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4})/i,
      );
      if (codeMatch && codeMatch[1]) {
        this.logger.debug('Found authentication code:', codeMatch[1]);
        return codeMatch[1];
      }

      // Alternative patterns for different document formats
      const altPatterns = [
        // More flexible pattern for authentication code
        /Código de autenticidade[:\s]*([A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4})/i,
        // Pattern without dashes
        /Código de autenticidade[:\s]*([A-F0-9]{32})/i,
        // Legacy patterns
        /Código de Autenticação:\s*([A-F0-9-]+)/i,
        /Authentication Code:\s*([A-F0-9-]+)/i,
      ];

      for (const pattern of altPatterns) {
        const match = pdfText.match(pattern);
        if (match && match[1]) {
          this.logger.debug(
            'Found authentication code with alternative pattern:',
            match[1],
          );
          return match[1];
        }
      }

      this.logger.error('Authentication code not found in PDF');
      throw new BadRequestException(
        'Código de autenticidade não encontrado no PDF. Verifique se o documento é válido e contém um código de autenticidade.',
      );
    } catch (error) {
      this.logger.error(
        'Error extracting authentication code from PDF:',
        error,
      );
      // If it's already a BadRequestException, re-throw it
      if (error instanceof BadRequestException) {
        throw error;
      }
      // For other errors (PDF processing errors), throw as BadRequestException too
      throw new BadRequestException(
        'Erro ao processar arquivo PDF. Verifique se o arquivo é um PDF válido.',
      );
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
          const codeMatch = pdfText.match(
            /Código de autenticidade:\s*([A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4})/i,
          );
          if (codeMatch && codeMatch[1]) {
            this.logger.debug(
              `Found authentication code using ${encoding} encoding (fallback):`,
              codeMatch[1],
            );
            return codeMatch[1];
          }

          // Alternative patterns for different document formats
          const altPatterns = [
            // More flexible pattern for authentication code
            /Código de autenticidade[:\s]*([A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4})/i,
            // Pattern without dashes
            /Código de autenticidade[:\s]*([A-F0-9]{32})/i,
            // Legacy patterns
            /Código de Autenticação:\s*([A-F0-9-]+)/i,
            /Authentication Code:\s*([A-F0-9-]+)/i,
          ];

          for (const pattern of altPatterns) {
            const match = pdfText.match(pattern);
            if (match && match[1]) {
              this.logger.debug(
                `Found authentication code with alternative pattern using ${encoding} encoding (fallback):`,
                match[1],
              );
              return match[1];
            }
          }
        } catch (error) {
          this.logger.debug(
            `Failed to decode PDF with ${encoding} encoding for auth code:`,
            error,
          );
        }
      }

      this.logger.error(
        'Authentication code not found in PDF using fallback method',
      );
      throw new BadRequestException(
        'Código de autenticidade não encontrado no PDF. Verifique se o documento é válido e contém um código de autenticidade.',
      );
    } catch (error) {
      this.logger.error('Error in auth code fallback extraction:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        'Erro ao processar arquivo PDF. Verifique se o arquivo é um PDF válido.',
      );
    }
  }

  /**
   * Extract enrollment number from PDF using PDF.js
   */
  async extractEnrollmentFromPdf(
    pdfBuffer: Buffer,
    fallbackToSimple = true,
  ): Promise<string | null> {
    try {
      this.logger.debug('Extracting enrollment number from PDF using PDF.js');
      const pdfText = await this.extractTextFromPdf(pdfBuffer);

      // If PDF.js failed, fall back to simple extraction
      if (pdfText === null) {
        this.logger.debug(
          'PDF.js failed for enrollment, falling back to simple extraction method',
        );
        if (fallbackToSimple) {
          return this.extractEnrollmentFromPdfSimple(pdfBuffer);
        }
        return null;
      }

      this.logger.debug(
        'PDF parsed successfully, text length:',
        pdfText.length,
      );

      // Look for common enrollment patterns
      const patterns = [
        /RA\s*n[ºo°]?\s*(\d+)/i,
        /Registro\s+Acad[eê]mico\s*:?\s*(\d+)/i,
        /R\.A\.?\s*:?\s*(\d+)/i,
        /matr[íi]cula\s*:?\s*(\d+)/i,
      ];

      for (const pattern of patterns) {
        const match = pdfText.match(pattern);
        if (match && match[1]) {
          this.logger.debug(
            `Found enrollment number '${match[1]}' using pattern ${pattern}`,
          );
          return match[1];
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
        this.logger.debug(
          'Falling back to simple extraction method due to error',
        );
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
            /RA\s*n[ºo°]?\s*(\d+)/i,
            /Registro\s+Acad[eê]mico\s*:?\s*(\d+)/i,
            /R\.A\.?\s*:?\s*(\d+)/i,
            /matr[íi]cula\s*:?\s*(\d+)/i,
          ];

          for (const pattern of patterns) {
            const match = pdfText.match(pattern);
            if (match && match[1]) {
              this.logger.debug(
                `Found enrollment number '${match[1]}' using pattern ${pattern} in ${encoding} encoding`,
              );
              return match[1];
            }
          }
        } catch (error) {
          this.logger.debug(
            `Failed to decode PDF with ${encoding} encoding:`,
            error,
          );
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
  async checkEnrollmentInPdf(
    pdfBuffer: Buffer,
    enrollmentNumber: string,
  ): Promise<boolean> {
    try {
      this.logger.debug('Checking enrollment number in PDF using PDF.js', {
        enrollmentNumber,
      });
      // Use PDF.js to properly extract text from PDF
      const pdfText = await this.extractTextFromPdf(pdfBuffer);

      // If PDF.js failed, fall back to simple buffer method
      if (pdfText === null) {
        this.logger.debug(
          'PDF.js failed for enrollment check, falling back to simple buffer method',
        );
        return this.checkEnrollmentInPdfFallback(pdfBuffer, enrollmentNumber);
      }

      this.logger.debug('Checking enrollment in PDF:', {
        enrollmentNumber,
        pdfTextLength: pdfText.length,
        pdfTextPreview: pdfText.substring(0, 200),
      });

      // Check for exact match and some variations
      const variations = [
        enrollmentNumber,
        enrollmentNumber.replace(/^0+/, ''), // Remove leading zeros
        `0${enrollmentNumber}`, // Add leading zero
        enrollmentNumber.replace(/(\d{4})(\d{4})/, '$1.$2'), // Add dot separator
        enrollmentNumber.replace(/(\d{4})(\d{4})/, '$1-$2'), // Add dash separator
      ];

      for (const variation of variations) {
        if (pdfText.includes(variation)) {
          this.logger.debug(
            `Found enrollment number '${variation}' in PDF using PDF.js`,
          );
          return true;
        }
      }

      // Also try with regex patterns for more flexible matching
      const patterns = [
        new RegExp(`\\b${enrollmentNumber}\\b`, 'i'),
        new RegExp(`\\b${enrollmentNumber.replace(/^0+/, '')}\\b`, 'i'),
        new RegExp(`\\b0*${enrollmentNumber}\\b`, 'i'),
      ];

      for (const pattern of patterns) {
        if (pattern.test(pdfText)) {
          this.logger.debug(
            `Found enrollment number using pattern ${pattern} in PDF`,
          );
          return true;
        }
      }

      this.logger.debug(
        `Enrollment number '${enrollmentNumber}' not found in PDF content`,
      );
      return false;
    } catch (error) {
      this.logger.error('Error checking enrollment in PDF:', error);

      // Fallback to simple buffer method if PDF.js fails
      this.logger.debug(
        'Falling back to simple buffer method for enrollment check',
      );
      return this.checkEnrollmentInPdfFallback(pdfBuffer, enrollmentNumber);
    }
  }

  /**
   * Fallback method for enrollment checking using raw buffer
   */
  private checkEnrollmentInPdfFallback(
    pdfBuffer: Buffer,
    enrollmentNumber: string,
  ): boolean {
    try {
      // Convert buffer to text using multiple encodings
      const encodings = ['latin1', 'utf8'];

      for (const encoding of encodings) {
        try {
          const pdfText = pdfBuffer.toString(encoding as BufferEncoding);

          // Check for exact match and some variations
          const variations = [
            enrollmentNumber,
            enrollmentNumber.replace(/^0+/, ''), // Remove leading zeros
            `0${enrollmentNumber}`, // Add leading zero
          ];

          for (const variation of variations) {
            if (pdfText.includes(variation)) {
              this.logger.debug(
                `Found enrollment number '${variation}' in PDF using ${encoding} encoding (fallback)`,
              );
              return true;
            }
          }
        } catch (error) {
          this.logger.debug(
            `Failed to decode PDF with ${encoding} encoding:`,
            error,
          );
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
  async checkFullnameInPdf(
    pdfBuffer: Buffer,
    expectedFullname: string,
  ): Promise<boolean> {
    try {
      this.logger.debug('Checking fullname in PDF using PDF.js', {
        expectedFullname,
      });

      // Use PDF.js to properly extract text from PDF
      const pdfText = await this.extractTextFromPdf(pdfBuffer);

      // If PDF.js failed, fall back to simple buffer method
      if (pdfText === null) {
        this.logger.debug(
          'PDF.js failed for fullname check, falling back to simple buffer method',
        );
        return this.checkFullnameInPdfFallback(pdfBuffer, expectedFullname);
      }

      this.logger.debug('Checking fullname in PDF using PDF.js:', {
        originalName: expectedFullname,
        pdfTextLength: pdfText.length,
        pdfTextPreview: pdfText.substring(0, 500),
      });

      // Look for specific name patterns in Unesp documents
      // Pattern 1: "Nome do Aluno Full Name Registro"
      // Pattern 2: "que Full Name,"
      const namePatterns = [
        /Nome do Aluno\s+([^R]+?)\s+Registro/i,
        /que\s+([^,]+),/i,
      ];

      let extractedName = '';
      for (const pattern of namePatterns) {
        const match = pdfText.match(pattern);
        if (match && match[1]) {
          extractedName = match[1].trim();
          this.logger.debug(
            `Found name using pattern ${pattern}:`,
            extractedName,
          );
          break;
        }
      }

      if (!extractedName) {
        this.logger.warn(
          'Could not extract name from PDF using known patterns',
        );
        // Fallback to old method if no specific pattern is found
        return this.checkFullnameInPdfFallback(pdfBuffer, expectedFullname);
      }

      // Normalize both names for comparison
      const normalizedExpected =
        this.normalizeNameForMatching(expectedFullname);
      const normalizedExtracted = this.normalizeNameForMatching(extractedName);

      this.logger.debug('Name comparison:', {
        expectedFullname,
        normalizedExpected,
        extractedName,
        normalizedExtracted,
      });

      // Check for exact match first
      if (normalizedExtracted === normalizedExpected) {
        this.logger.debug('Exact fullname match found');
        return true;
      }

      // Check if the expected name is contained within the extracted name
      // (handles cases where PDF has more complete name)
      if (normalizedExtracted.includes(normalizedExpected)) {
        this.logger.debug('Expected name is contained in extracted name');
        return true;
      }

      // Check if the extracted name is contained within the expected name
      // (handles cases where user provided more complete name)
      if (normalizedExpected.includes(normalizedExtracted)) {
        this.logger.debug('Extracted name is contained in expected name');
        return true;
      }

      // More strict word-by-word comparison
      // All significant words from the expected name must be present in the extracted name
      const expectedWords = normalizedExpected
        .split(' ')
        .filter((word) => word.length > 2); // Only significant words

      const extractedWords = normalizedExtracted.split(' ');
      let matchedWords = 0;

      for (const expectedWord of expectedWords) {
        const found = extractedWords.some(
          (extractedWord) =>
            extractedWord.includes(expectedWord) ||
            expectedWord.includes(extractedWord),
        );
        if (found) {
          matchedWords++;
          this.logger.debug(`Matched word: ${expectedWord}`);
        } else {
          this.logger.debug(`Missing word: ${expectedWord}`);
        }
      }

      // Require ALL significant words to match (100% match)
      const matchRatio = matchedWords / expectedWords.length;
      const isMatch = matchRatio === 1.0;

      this.logger.debug('Strict name verification result:', {
        expectedWords: expectedWords.length,
        matchedWords,
        matchRatio: Math.round(matchRatio * 100) + '%',
        isMatch,
        requiredRatio: '100%',
      });

      if (!isMatch) {
        this.logger.warn(
          `Name verification failed: Only ${matchedWords}/${expectedWords.length} words matched. ` +
            `Expected name: "${expectedFullname}" vs Extracted name: "${extractedName}". ` +
            `Please ensure the user has provided their complete full name as it appears in the university document.`,
        );
      }

      return isMatch;
    } catch (error) {
      this.logger.error('Error checking fullname in PDF with PDF.js:', error);

      // Fallback to simple buffer method if PDF.js fails
      this.logger.debug(
        'Falling back to simple buffer method for fullname check',
      );
      return this.checkFullnameInPdfFallback(pdfBuffer, expectedFullname);
    }
  }

  /**
   * Fallback method for fullname checking using raw buffer
   */
  private checkFullnameInPdfFallback(
    pdfBuffer: Buffer,
    expectedFullname: string,
  ): boolean {
    try {
      // Convert buffer to text using multiple encodings
      const encodings = ['latin1', 'utf8'];

      // Normalize the expected fullname for better matching
      const normalizedExpected =
        this.normalizeNameForMatching(expectedFullname);

      this.logger.debug('Checking fullname in PDF using fallback method:', {
        originalName: expectedFullname,
        normalizedName: normalizedExpected,
      });

      for (const encoding of encodings) {
        try {
          const pdfText = pdfBuffer.toString(encoding as BufferEncoding);
          const normalizedPdfText = this.normalizeNameForMatching(pdfText);

          // Check for exact match first
          if (normalizedPdfText.includes(normalizedExpected)) {
            this.logger.debug(
              `Found exact fullname '${expectedFullname}' in PDF using ${encoding} encoding (fallback)`,
            );
            return true;
          }

          // Strict word-by-word verification for fallback too
          const expectedWords = normalizedExpected
            .split(' ')
            .filter((word) => word.length > 2);

          let matchedWords = 0;
          for (const word of expectedWords) {
            if (normalizedPdfText.includes(word)) {
              matchedWords++;
            }
          }

          // Require ALL words to match (100% match) in fallback too
          const matchRatio = matchedWords / expectedWords.length;
          if (matchRatio === 1.0) {
            this.logger.debug(
              `Found strict fullname match in PDF using ${encoding} encoding (fallback): ${matchedWords}/${expectedWords.length} words matched`,
            );
            return true;
          } else {
            this.logger.debug(
              `Insufficient word match in ${encoding} encoding (fallback): ${matchedWords}/${expectedWords.length} (${Math.round(matchRatio * 100)}%)`,
            );
          }
        } catch (error) {
          this.logger.debug(
            `Failed to decode PDF with ${encoding} encoding:`,
            error,
          );
        }
      }

      this.logger.warn(
        `Fullname '${expectedFullname}' not found in PDF content using fallback method. ` +
          `Please ensure the user has provided their complete full name as it appears in the university document.`,
      );
      return false;
    } catch (error) {
      this.logger.error('Error in fullname fallback check:', error);
      return false;
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
        this.logger.debug(
          'PDF.js failed, trying simple buffer extraction for name',
        );
        return this.extractNameFromPdfSimple(pdfBuffer);
      }

      this.logger.debug('Extracting name from PDF:', {
        pdfTextLength: pdfText.length,
        pdfTextPreview: pdfText.substring(0, 500),
      });

      // Pattern 1: "Nome do Aluno Full Name Registro"
      // Pattern 2: "que Full Name,"
      const namePatterns = [
        /Nome do Aluno\s+([^R]+?)\s+Registro/i,
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
          this.logger.debug(
            `Found name using pattern ${pattern}:`,
            extractedName,
          );
          return extractedName;
        }
      }

      this.logger.debug(
        'No name found using PDF.js patterns, trying simple method',
      );
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
            /Nome do Aluno\s+([^R]+?)\s+Registro/i,
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
              this.logger.debug(
                `Found name using pattern ${pattern} in ${encoding} encoding (fallback):`,
                extractedName,
              );
              return extractedName;
            }
          }
        } catch (error) {
          this.logger.debug(
            `Failed to decode PDF with ${encoding} encoding:`,
            error,
          );
        }
      }

      this.logger.debug('No name found in PDF content using simple method');
      return null;
    } catch (error) {
      this.logger.error(
        'Error extracting name from PDF (simple method):',
        error,
      );
      return null;
    }
  }

  /**
   * Extract filename from Content-Disposition header
   */
  extractFilenameFromContentDisposition(
    headers: Record<string, string | string[] | undefined>,
  ): string | null {
    const contentDisposition = headers['content-disposition'] as string;
    if (!contentDisposition) {
      return null;
    }

    const filenameMatch = contentDisposition.match(
      /filename[^;=\n]*=((['"]).?\2|[^;\n]*)/,
    );
    return filenameMatch ? filenameMatch[1].replace(/['"]/g, '') : null;
  }

  /**
   * Test method to verify authentication code extraction
   */
  testAuthCodeExtraction(sampleText: string): string | null {
    try {
      // Test the same patterns used in extractAuthCodeFromPdf
      const codeMatch = sampleText.match(
        /Código de autenticidade:\s*([A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4})/i,
      );
      if (codeMatch && codeMatch[1]) {
        this.logger.debug('Test found authentication code:', codeMatch[1]);
        return codeMatch[1];
      }

      // Alternative patterns
      const altPatterns = [
        /Código de autenticidade[:\s]*([A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4})/i,
        /Código de autenticidade[:\s]*([A-F0-9]{32})/i,
        /Código de Autenticação:\s*([A-F0-9-]+)/i,
        /Authentication Code:\s*([A-F0-9-]+)/i,
      ];

      for (const pattern of altPatterns) {
        const match = sampleText.match(pattern);
        if (match && match[1]) {
          this.logger.debug(
            'Test found authentication code with alternative pattern:',
            match[1],
          );
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
