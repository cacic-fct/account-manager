jest.mock('../../student-verification/student-verification.service', () => ({
  StudentVerificationService: class StudentVerificationService {},
}));
jest.mock('./pdf-processing.service', () => ({ PdfProcessingService: class PdfProcessingService {} }));
jest.mock('./user-verification.service', () => ({ UserVerificationService: class UserVerificationService {} }));

import type { S3Service } from '../../common/services/s3.service';
import type { StudentVerificationService } from '../../student-verification/student-verification.service';
import type { CaptchaSession } from '../university-validation.types';
import { DocumentValidationService } from './document-validation.service';
import type { PdfProcessingService } from './pdf-processing.service';
import type { UserVerificationService } from './user-verification.service';

describe('DocumentValidationService', () => {
  const authCode = 'AAAA-BBBB-CCCC-DDDD-1111-2222-3333-4444';
  const createContext = () => {
    const student = {
      verifyPdfDocument: jest.fn(),
      storeManualReviewDocument: jest.fn().mockResolvedValue({ documentId: 'manual-1' }),
      storeAutomatedApproval: jest.fn().mockResolvedValue({ id: 'approved-1' }),
      deferAutomatedApproval: jest.fn().mockResolvedValue(undefined),
    };
    const pdf = { extractAuthCodeFromPdf: jest.fn().mockResolvedValue(authCode) };
    const user = {
      isExternalUser: jest.fn(),
      getUserFullname: jest.fn().mockResolvedValue('Maria da Silva'),
      verifyExternalUser: jest.fn(),
      verifyUnespStudent: jest.fn(),
      setVerificationStatus: jest.fn().mockResolvedValue(undefined),
      applyExternalUserVerification: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DocumentValidationService(
      student as unknown as StudentVerificationService,
      pdf as unknown as PdfProcessingService,
      user as unknown as UserVerificationService,
      {} as S3Service,
    );
    return { service, student, pdf, user };
  };
  const session = { authCode, createdAt: new Date() } as CaptchaSession;
  const validate = (service: DocumentValidationService) =>
    service.validatePdfDocument(session, Buffer.from('%PDF-provider'), '12345678', 'A1B2', 'session-1', 'user-1');

  it('rejects a provider PDF that is not bound to the submitted authentication code', async () => {
    const { service, student, pdf } = createContext();
    pdf.extractAuthCodeFromPdf.mockResolvedValue('FFFF-EEEE-DDDD-CCCC-BBBB-AAAA-9999-8888');

    await expect(validate(service)).resolves.toMatchObject({ success: false });
    expect(student.verifyPdfDocument).not.toHaveBeenCalled();
  });

  it('queues manual review when document-validity verification is unavailable', async () => {
    const { service, student } = createContext();
    student.verifyPdfDocument.mockResolvedValue({ success: false, error: 'offline' });

    await expect(validate(service)).resolves.toMatchObject({
      success: false,
      fallbackToManual: true,
      manualApprovalId: 'manual-1',
    });
  });

  it('fails closed to manual review when Keycloak identity data is unavailable', async () => {
    const { service, student, user } = createContext();
    student.verifyPdfDocument.mockResolvedValue({ success: true, data: { isValid: true } });
    user.isExternalUser.mockRejectedValue(new Error('keycloak offline'));

    await expect(validate(service)).resolves.toMatchObject({
      success: false,
      fallbackToManual: true,
      manualApprovalId: 'manual-1',
    });
  });

  it('persists approval before applying the idempotent identity transition', async () => {
    const { service, student, user } = createContext();
    student.verifyPdfDocument.mockResolvedValue({
      success: true,
      data: { isValid: true, emissionDate: '2026-01-01', expirationDate: '2027-01-01' },
    });
    user.isExternalUser.mockResolvedValue(false);
    user.verifyUnespStudent.mockResolvedValue({
      enrollmentMatches: true,
      fullnameMatches: true,
      combinedResult: true,
    });

    await expect(validate(service)).resolves.toMatchObject({ success: true, isValid: true });
    expect(student.storeAutomatedApproval).toHaveBeenCalled();
    expect(user.setVerificationStatus).toHaveBeenCalledWith('user-1', true, 'unesp_student', expect.any(Object));
    expect(student.storeAutomatedApproval.mock.invocationCallOrder[0]).toBeLessThan(
      user.setVerificationStatus.mock.invocationCallOrder[0],
    );
  });

  it('defers database approval and attempts identity compensation when Keycloak sync fails', async () => {
    const { service, student, user } = createContext();
    student.verifyPdfDocument.mockResolvedValue({ success: true, data: { isValid: true } });
    user.isExternalUser.mockResolvedValue(false);
    user.verifyUnespStudent.mockResolvedValue({
      enrollmentMatches: true,
      fullnameMatches: true,
      combinedResult: true,
    });
    user.setVerificationStatus.mockRejectedValueOnce(new Error('keycloak offline')).mockResolvedValueOnce(undefined);

    await expect(validate(service)).resolves.toMatchObject({
      success: false,
      fallbackToManual: true,
      manualApprovalId: 'approved-1',
    });
    expect(user.setVerificationStatus).toHaveBeenLastCalledWith('user-1', false, 'unesp_student');
    expect(student.deferAutomatedApproval).toHaveBeenCalledWith('approved-1', 'user-1');
  });
});
