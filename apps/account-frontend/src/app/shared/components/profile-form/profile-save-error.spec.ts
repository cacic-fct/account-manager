import { HttpErrorResponse } from '@angular/common/http';
import { describeProfileSaveError } from './profile-save-error';

describe('describeProfileSaveError', () => {
  const statusCases: Array<[status: number, message: string]> = [
    [0, 'Não foi possível confirmar o salvamento. Verifique sua conexão e tente novamente.'],
    [401, 'Sua sessão pode ter expirado. Entre novamente na sua conta para continuar.'],
    [403, 'A solicitação não foi autorizada. Tente salvar novamente. Se continuar, entre novamente na sua conta.'],
    [404, 'Não foi possível localizar sua conta. Peça ajuda ao suporte para verificar seu acesso.'],
    [409, 'Há um conflito com os dados cadastrados. Peça ajuda ao suporte para verificar seu cadastro.'],
    [429, 'Foram feitas muitas tentativas em pouco tempo. Aguarde alguns instantes antes de salvar novamente.'],
    [503, 'O serviço está com dificuldades para salvar seu perfil. Tente novamente em alguns instantes.'],
  ];

  it.each(statusCases)('maps HTTP status %s to safe guidance', (status, message) => {
    const result = describeProfileSaveError(new HttpErrorResponse({ status }), true);

    expect(result.title).toBe('Não foi possível salvar as alterações');
    expect(result.message).toBe(message);
  });

  it('uses the onboarding title and generic guidance for an unknown error', () => {
    const result = describeProfileSaveError(new Error('database password leaked by the server'), false);

    expect(result.title).toBe('Não foi possível concluir seu cadastro');
    expect(result.message).toBe('Ocorreu um erro inesperado. Tente salvar novamente em alguns instantes.');
    expect(result.supportDetails).toContain('Status: indisponível');
    expect(result.supportDetails).not.toContain('database password');
  });

  it('maps a known validation message supplied as a string', () => {
    const result = describeProfileSaveError(
      new HttpErrorResponse({
        status: 400,
        error: { message: 'Invalid phone number format. Please use a valid international phone number.' },
      }),
      false,
    );

    expect(result.message).toBe('Confira o telefone e o código do país antes de salvar novamente.');
  });

  it('maps a validation field from a message array without showing arbitrary server text', () => {
    const result = describeProfileSaveError(
      new HttpErrorResponse({
        status: 400,
        error: {
          message: ['phone must be a string', 'unexpected value: Ana Example, CPF 12345678901'],
        },
      }),
      true,
    );

    expect(result.message).toBe('Confira os seguintes dados antes de salvar novamente: telefone.');
    expect(result.message).not.toContain('Ana Example');
    expect(result.message).not.toContain('12345678901');
  });

  it('directs immutable identity changes to support without repeating backend details', () => {
    const backendMessage = 'Nome completo não pode ser alterado após verificação por documento. Entre em contato com o suporte se necessário.';
    const result = describeProfileSaveError(
      new HttpErrorResponse({ status: 400, error: { message: backendMessage } }),
      true,
    );

    expect(result.message).toBe(
      'Os dados de identificação já cadastrados não podem ser alterados aqui. Peça ajuda ao suporte para corrigir esses dados.',
    );
    expect(result.message).not.toContain(backendMessage);
  });

  it('keeps backend personal data and stack traces out of user and support details', () => {
    const result = describeProfileSaveError(
      new HttpErrorResponse({
        status: 500,
        error: {
          message: 'Falha no banco para Ana Example, CPF 12345678901, ana@example.test',
          stack: 'DatabaseError: internal-host:5432\n  at updateUserAttributes (/srv/private.js:42:9)',
        },
      }),
      false,
    );

    const displayedContent = `${result.title}\n${result.message}\n${result.supportDetails}`;
    expect(displayedContent).not.toContain('Ana Example');
    expect(displayedContent).not.toContain('12345678901');
    expect(displayedContent).not.toContain('ana@example.test');
    expect(displayedContent).not.toContain('internal-host');
    expect(displayedContent).not.toContain('/srv/private.js');
  });

  it('includes the operation stage, fixed UTC timestamp, and status in support details', () => {
    const occurredAt = new Date('2026-10-09T18:24:35.000Z');
    const result = describeProfileSaveError(new HttpErrorResponse({ status: 503 }), false, occurredAt);

    expect(result.supportDetails).toContain('Etapa: cadastro inicial');
    expect(result.supportDetails).toContain('Horário (UTC): 2026-10-09T18:24:35.000Z');
    expect(result.supportDetails).toContain('Status: 503');
    expect(result.supportDetails).toContain(`Orientação: ${result.message}`);
  });
});

// Unexpected response shapes must not leak backend content or interrupt recovery.
describe('unrecognized profile validation responses', () => {
  it.each([null, 'private server response', { message: ['toString', '__proto__', null, 1] }])(
    'uses generic guidance for %s',
    (body) => {
      const result = describeProfileSaveError(new HttpErrorResponse({ status: 422, error: body }), false);
      expect(result.message).toBe('Alguns dados não foram aceitos. Confira os campos do formulário e tente salvar novamente.');
    },
  );

  it('lists all missing fields with Portuguese labels', () => {
    const result = describeProfileSaveError(new HttpErrorResponse({
      status: 400,
      error: { message: 'Missing required fields: fullname, phone, identityDocument' },
    }), false);
    expect(result.message).toContain('nome completo, telefone, CPF ou passaporte');
  });
});
