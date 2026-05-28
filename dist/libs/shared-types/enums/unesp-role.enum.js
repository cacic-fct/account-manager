"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STUDENT_ROLES = exports.UNESP_ROLE_LABELS = exports.UnespRole = void 0;
exports.isStudentRole = isStudentRole;
exports.isUndergraduateStudentRole = isUndergraduateStudentRole;
exports.getUnespRoleOptions = getUnespRoleOptions;
var UnespRole;
(function (UnespRole) {
    UnespRole["ALUNO_GRADUACAO"] = "aluno-graduacao";
    UnespRole["ALUNO_POS_GRADUACAO"] = "aluno-pos-graduacao";
    UnespRole["EGRESSO"] = "egresso";
    UnespRole["PROFESSOR"] = "professor";
    UnespRole["PROFESSOR_SUBSTITUTO"] = "professor-substituto";
    UnespRole["SERVIDOR_TECNICO_ADMINISTRATIVO"] = "servidor-tecnico-administrativo";
})(UnespRole || (exports.UnespRole = UnespRole = {}));
exports.UNESP_ROLE_LABELS = {
    [UnespRole.ALUNO_GRADUACAO]: 'Aluno da graduação',
    [UnespRole.ALUNO_POS_GRADUACAO]: 'Aluno da pós-graduação',
    [UnespRole.EGRESSO]: 'Egresso',
    [UnespRole.PROFESSOR]: 'Professor',
    [UnespRole.PROFESSOR_SUBSTITUTO]: 'Professor substituto',
    [UnespRole.SERVIDOR_TECNICO_ADMINISTRATIVO]: 'Servidor técnico-administrativo',
};
exports.STUDENT_ROLES = [
    UnespRole.ALUNO_GRADUACAO,
    UnespRole.ALUNO_POS_GRADUACAO,
];
function isStudentRole(role) {
    return exports.STUDENT_ROLES.includes(role);
}
function isUndergraduateStudentRole(role) {
    return role === UnespRole.ALUNO_GRADUACAO;
}
function getUnespRoleOptions() {
    return Object.values(UnespRole).map((role) => ({
        value: role,
        label: exports.UNESP_ROLE_LABELS[role],
    }));
}
