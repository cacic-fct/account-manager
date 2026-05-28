"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDiscordAvatarUrl = getDiscordAvatarUrl;
exports.isAnimatedAvatar = isAnimatedAvatar;
function getDiscordAvatarUrl(userId, avatarHash, size = 128) {
    if (avatarHash) {
        const extension = avatarHash.startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${extension}?size=${size}`;
    }
    const discriminator = (BigInt(userId) >> BigInt(22)) % BigInt(6);
    return `https://cdn.discordapp.com/embed/avatars/${discriminator}.png?size=${size}`;
}
function isAnimatedAvatar(avatarHash) {
    return avatarHash?.startsWith('a_') ?? false;
}
