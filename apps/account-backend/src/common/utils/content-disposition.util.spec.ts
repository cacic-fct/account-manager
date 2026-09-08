import { createAttachmentContentDisposition } from './content-disposition.util';

describe('createAttachmentContentDisposition', () => {
  it('preserves a UTF-8 filename while providing a safe ASCII fallback', () => {
    expect(createAttachmentContentDisposition('comprovante-matrícula.pdf', 'documento.pdf')).toBe(
      `attachment; filename="comprovante-matr_cula.pdf"; filename*=UTF-8''comprovante-matr%C3%ADcula.pdf`,
    );
  });

  it('removes header controls and prevents quoted filename parameter injection', () => {
    const result = createAttachmentContentDisposition('documento"; falso="sim\r\nX-Injetado: sim.pdf', 'documento.pdf');

    expect(result).not.toMatch(/[\r\n]/);
    expect(result).toContain('filename="documento__ falso=_simX-Injetado: sim.pdf"');
    expect(result).toContain("filename*=UTF-8''documento%22%3B%20falso%3D%22simX-Injetado%3A%20sim.pdf");
  });

  it('uses a safe fallback for an empty stored filename', () => {
    expect(createAttachmentContentDisposition('\u0000\r\n', 'dados-lgpd.zip')).toContain('filename="dados-lgpd.zip"');
  });
});
