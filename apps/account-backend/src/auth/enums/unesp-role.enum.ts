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
  'almir.artero@unesp.br',
  'analice.brandi@unesp.br',
  'cassio.oishi@unesp.br',
  'celso.olivete@unesp.br',
  'cristiane.nespoli@unesp.br',
  'danilo.eler@unesp.br',
  'gilcilene.sanchez@unesp.br',
  'jose.nogueira@unesp.br',
  'danillo.pereira@unesp.br',
  'irineu.palhares@unesp.br',
  'marcelo.messias1@unesp.br',
  'marcio.cardim@unesp.br',
  'marcos.pimenta@unesp.br',
  'ma.dias@unesp.br',
  'messias.meneguette@unesp.br',
  'mr.candido@unesp.br',
  'priscila.alessio@unesp.br',
  'rogerio.garcia@unesp.br',
  'ronaldo.correia@unesp.br',
  'ronan.reis@unesp.br',
  's.meira@unesp.br',
  'vanessa.botta@unesp.br',
  'maria.raquel@unesp.br',
  'm.stapenhorst@unesp.br',
  'marco.piteri@unesp.br',
];

export function isProfessorEmail(email: string): boolean {
  return PROFESSOR_EMAILS.includes(email.toLowerCase());
}
