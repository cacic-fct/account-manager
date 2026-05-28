export type AccountMergeStatus = 'pending' | 'pending_score' | 'pending_merge' | 'completed' | 'cancelled' | 'expired' | 'failed';
export interface AccountMergeScoreContribution {
    source: string;
    label: string;
    points: number;
}
export interface AccountMergeUserScore {
    userId: string;
    email: string;
    displayName: string;
    score: number;
    contributions: AccountMergeScoreContribution[];
}
export interface ExternalAccountMergeScore {
    backend: string;
    scores: Record<string, number>;
    error?: string;
}
export interface AccountMergeRequest {
    id: string;
    status: AccountMergeStatus;
    requesterUserId: string;
    candidateUserId: string;
    primaryUserId: string;
    secondaryUserId: string;
    primaryEmailOptions: string[];
    selectedPrimaryEmail?: string;
    secondaryEmails: string[];
    notificationSummary: {
        pending: number;
        completed: number;
        failed: number;
    };
    scores: AccountMergeUserScore[];
    externalScores: ExternalAccountMergeScore[];
    expiresAt: string;
    completedAt?: string;
    createdAt: string;
}
export interface ConfirmAccountMergeRequest {
    primaryEmail: string;
}
export interface ConfirmAccountMergeResponse {
    request: AccountMergeRequest;
    primaryUserId: string;
    mergedUserId: string;
    primaryEmail: string;
    secondaryEmails: string[];
}
export interface AccountLinkingStartUrl {
    url: string;
}
//# sourceMappingURL=account-linking.interface.d.ts.map