export enum UnespRole {
  ALUNO_GRADUACAO = 'aluno-graduacao',
  ALUNO_POS_GRADUACAO = 'aluno-pos-graduacao',
  EGRESSO = 'egresso',
  PROFESSOR = 'professor',
  PROFESSOR_SUBSTITUTO = 'professor-substituto',
  SERVIDOR_TECNICO_ADMINISTRATIVO = 'servidor-tecnico-administrativo',
}

export const UNESP_ROLE_LABELS: Record<UnespRole, string> = {
  [UnespRole.ALUNO_GRADUACAO]: 'Aluno da graduação',
  [UnespRole.ALUNO_POS_GRADUACAO]: 'Aluno da pós-graduação',
  [UnespRole.EGRESSO]: 'Egresso',
  [UnespRole.PROFESSOR]: 'Professor',
  [UnespRole.PROFESSOR_SUBSTITUTO]: 'Professor substituto',
  [UnespRole.SERVIDOR_TECNICO_ADMINISTRATIVO]: 'Servidor técnico-administrativo',
};

export const STUDENT_ROLES = [UnespRole.ALUNO_GRADUACAO, UnespRole.ALUNO_POS_GRADUACAO] as const;

export function isStudentRole(role: UnespRole): boolean {
  return STUDENT_ROLES.includes(role as (typeof STUDENT_ROLES)[number]);
}

export function isUndergraduateStudentRole(role: UnespRole): boolean {
  return role === UnespRole.ALUNO_GRADUACAO;
}

export function getUnespRoleOptions(): Array<{
  value: UnespRole;
  label: string;
}> {
  return Object.values(UnespRole).map((role) => ({
    value: role,
    label: UNESP_ROLE_LABELS[role],
  }));
}
