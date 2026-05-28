export declare enum UnespRole {
    ALUNO_GRADUACAO = "aluno-graduacao",
    ALUNO_POS_GRADUACAO = "aluno-pos-graduacao",
    EGRESSO = "egresso",
    PROFESSOR = "professor",
    PROFESSOR_SUBSTITUTO = "professor-substituto",
    SERVIDOR_TECNICO_ADMINISTRATIVO = "servidor-tecnico-administrativo"
}
export declare const UNESP_ROLE_LABELS: Record<UnespRole, string>;
export declare const STUDENT_ROLES: readonly [UnespRole.ALUNO_GRADUACAO, UnespRole.ALUNO_POS_GRADUACAO];
export declare function isStudentRole(role: UnespRole): boolean;
export declare function isUndergraduateStudentRole(role: UnespRole): boolean;
export declare function getUnespRoleOptions(): Array<{
    value: UnespRole;
    label: string;
}>;
//# sourceMappingURL=unesp-role.enum.d.ts.map