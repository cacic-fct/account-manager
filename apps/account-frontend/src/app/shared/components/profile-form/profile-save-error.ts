import { HttpErrorResponse } from '@angular/common/http';

export interface ProfileSaveError {
  title: string;
  message: string;
  supportDetails: string;
}

const identityErrors = new Set([
  'Nome completo não pode ser alterado após o cadastro.',
  'Nome completo não pode ser alterado após verificação por documento. Entre em contato com o suporte se necessário.',
  'Tipo de documento não pode ser alterado após o cadastro.',
  'Documento de identidade não pode ser alterado após o cadastro.',
  'CPF não pode ser alterado após o cadastro.',
  'País emissor do passaporte não pode ser alterado após o cadastro.',
]);

const fieldLabels: Record<string, string> = {
  fullname: 'nome completo',
  phone: 'telefone',
  identityDocument: 'CPF ou passaporte',
  passportCountry: 'país emissor do passaporte',
  isForeigner: 'tipo de documento',
  enrollmentNumber: 'número de matrícula',
  unespRole: 'vínculo com a Unesp',
};

function validationMessage(error: HttpErrorResponse): string {
  const body: unknown = error.error;
  const message: unknown = body && typeof body === 'object' && 'message' in body ? body.message : undefined;
  const messages = Array.isArray(message)
    ? message.filter((item): item is string => typeof item === 'string')
    : typeof message === 'string'
      ? [message]
      : [];

  if (messages.some((item) => identityErrors.has(item))) {
    return 'Os dados de identificação já cadastrados não podem ser alterados aqui. Peça ajuda ao suporte para corrigir esses dados.';
  }

  const knownMessages: Record<string, string> = {
    'Invalid phone number format. Please use a valid international phone number.':
      'Confira o telefone e o código do país antes de salvar novamente.',
    'Invalid passport document format.': 'Confira o número do passaporte antes de salvar novamente.',
    'CPF must contain exactly 11 digits.': 'Confira o CPF: ele deve conter 11 dígitos.',
    'Enrollment number is required for student roles':
      'Informe o número de matrícula para o vínculo de estudante selecionado.',
    'Enrollment number can only be set for student roles':
      'O número de matrícula só pode ser informado para um vínculo de estudante.',
    'User is missing required email information':
      'Não foi possível confirmar o e-mail da sua conta. Peça ajuda ao suporte.',
  };
  const knownMessage = messages.map((item) => Object.hasOwn(knownMessages, item) ? knownMessages[item] : undefined).find(Boolean);
  if (knownMessage) return knownMessage;

  // Only field names are shown; arbitrary server text may contain personal data.
  const fields = Object.entries(fieldLabels)
    .filter(([field]) =>
      messages.some(
        (item) =>
          item.startsWith(`${field} `) ||
          (item.startsWith('Missing required fields: ') &&
            item.slice('Missing required fields: '.length).split(', ').includes(field)),
      ),
    )
    .map(([, label]) => label);

  return fields.length > 0
    ? `Confira os seguintes dados antes de salvar novamente: ${fields.join(', ')}.`
    : 'Alguns dados não foram aceitos. Confira os campos do formulário e tente salvar novamente.';
}

export function describeProfileSaveError(
  error: unknown,
  isEditMode: boolean,
  occurredAt = new Date(),
): ProfileSaveError {
  const status = error instanceof HttpErrorResponse ? error.status : undefined;
  const title = isEditMode ? 'Não foi possível salvar as alterações' : 'Não foi possível concluir seu cadastro';
  let message = 'Ocorreu um erro inesperado. Tente salvar novamente em alguns instantes.';

  if (status === 0) {
    message = 'Não foi possível confirmar o salvamento. Verifique sua conexão e tente novamente.';
  } else if (error instanceof HttpErrorResponse && (status === 400 || status === 422)) {
    message = validationMessage(error);
  } else if (status === 401) {
    message = 'Sua sessão pode ter expirado. Entre novamente na sua conta para continuar.';
  } else if (status === 403) {
    message = 'A solicitação não foi autorizada. Tente salvar novamente. Se continuar, entre novamente na sua conta.';
  } else if (status === 404) {
    message = 'Não foi possível localizar sua conta. Peça ajuda ao suporte para verificar seu acesso.';
  } else if (status === 409) {
    message = 'Há um conflito com os dados cadastrados. Peça ajuda ao suporte para verificar seu cadastro.';
  } else if (status === 429) {
    message = 'Foram feitas muitas tentativas em pouco tempo. Aguarde alguns instantes antes de salvar novamente.';
  } else if (status !== undefined && status >= 500) {
    message = 'O serviço está com dificuldades para salvar seu perfil. Tente novamente em alguns instantes.';
  }

  return {
    title,
    message,
    supportDetails: [
      'Conta CACiC - falha ao salvar perfil',
      `Etapa: ${isEditMode ? 'edição de perfil' : 'cadastro inicial'}`,
      `Horário (UTC): ${occurredAt.toISOString()}`,
      `Status: ${status === 0 ? 'sem resposta do servidor' : (status ?? 'indisponível')}`,
      `Orientação: ${message}`,
    ].join('\n'),
  };
}
