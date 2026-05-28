export {
  UnespRole,
  UNESP_ROLE_LABELS,
  STUDENT_ROLES,
  isStudentRole,
  isUndergraduateStudentRole,
  getUnespRoleOptions,
} from '@cacic/shared-types';

// Hardcoded list of professor emails
export const PROFESSOR_EMAILS = [
  'professor1@unesp.br',
  'professor2@unesp.br',
  'admin@unesp.br',
];

export function isProfessorEmail(email: string): boolean {
  return PROFESSOR_EMAILS.includes(email.toLowerCase());
}
