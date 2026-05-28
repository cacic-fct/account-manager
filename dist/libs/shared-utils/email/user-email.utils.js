"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUnespEmail = isUnespEmail;
const UNESP_EMAIL_DOMAIN = '@unesp.br';
function isUnespEmail(email) {
    if (!email) {
        return false;
    }
    return email.toLowerCase().endsWith(UNESP_EMAIL_DOMAIN);
}
