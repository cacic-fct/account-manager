jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: jest.fn(() => ({
    promise: Promise.reject(new Error('invalid test PDF')),
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { PdfProcessingService } from './pdf-processing.service';

describe('PdfProcessingService security checks', () => {
  const service = new PdfProcessingService();

  it('rejects empty and all-zero enrollment identifiers before comparison', async () => {
    await expect(service.checkEnrollmentInPdf(Buffer.from('RA 00000000'), '')).resolves.toBe(false);
    await expect(service.checkEnrollmentInPdf(Buffer.from('RA 00000000'), '00000000')).resolves.toBe(false);
    await expect(service.extractEnrollmentFromPdf(Buffer.from('RA 00000000'))).resolves.toBeNull();
  });

  it('requires a complete full name', async () => {
    await expect(service.checkFullnameInPdf(Buffer.from('JOAO SILVA'), '')).resolves.toBe(false);
    await expect(service.checkFullnameInPdf(Buffer.from('JOAO SILVA'), 'Joao')).resolves.toBe(false);
  });

  it('rejects overlong authentication-code matches', () => {
    const overlong = `Authentication Code: ${'AAAA-'.repeat(20)}AAAA`;
    expect(service.testAuthCodeExtraction(overlong)).toBeNull();
  });
});
