jest.mock('./pdf-processing.service', () => ({
  PdfProcessingService: class PdfProcessingService {},
}));

import type { KeycloakService } from '../../auth/services/keycloak.service';
import type { PdfProcessingService } from './pdf-processing.service';
import { UserVerificationService } from './user-verification.service';

describe('UserVerificationService', () => {
  const createService = () => {
    const keycloak = {
      getUserBasicInfo: jest.fn(),
      getUserAttributes: jest.fn(),
      updateUserAttributes: jest.fn(),
      setUnespRoleVerified: jest.fn(),
      verifyUserUnespRole: jest.fn(),
    };
    const pdf = {
      checkFullnameInPdf: jest.fn(),
      checkEnrollmentInPdf: jest.fn(),
      extractEnrollmentFromPdf: jest.fn(),
    };
    return {
      service: new UserVerificationService(
        keycloak as unknown as KeycloakService,
        pdf as unknown as PdfProcessingService,
      ),
      keycloak,
      pdf,
    };
  };

  it('fails closed when identity classification has no email', async () => {
    const { service, keycloak } = createService();
    keycloak.getUserBasicInfo.mockResolvedValue({});
    await expect(service.isExternalUser('user-1')).rejects.toThrow('determinar o tipo de vínculo');
  });

  it('does not verify an external user on name alone', async () => {
    const { service, pdf } = createService();
    pdf.checkFullnameInPdf.mockResolvedValue(true);
    pdf.extractEnrollmentFromPdf.mockResolvedValue(null);

    await expect(service.verifyExternalUser(Buffer.from('%PDF-'), 'Maria da Silva')).resolves.toEqual({
      nameMatches: false,
      extractedEnrollment: null,
    });
  });

  it('requires both enrollment and full-name matches for UNESP users', async () => {
    const { service, pdf } = createService();
    pdf.checkEnrollmentInPdf.mockResolvedValue(true);
    pdf.checkFullnameInPdf.mockResolvedValue(false);

    await expect(
      service.verifyUnespStudent('user-1', Buffer.from('%PDF-'), '12345678', 'Maria da Silva'),
    ).resolves.toMatchObject({ combinedResult: false });
  });
});
