export interface LgpdRequest {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdAt: Date;
    downloadedAt?: Date;
    expiresAt?: Date;
    fileName?: string;
    fileSize?: number;
    errorMessage?: string;
}
export interface LgpdRequestDetail extends LgpdRequest {
    userId: string;
    email: string;
    updatedAt: Date;
}
export interface DeleteAccountRequest {
    confirmation: string;
    reason?: string;
}
export interface DeleteAccountResponse {
    message: string;
    requestedAt: Date;
    servicesNotified: string[];
    scheduledHardDeleteAt: Date;
}
export interface AdminDeleteAccountRequest {
    id: string;
    userId: string;
    email: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    reason?: string;
    softDeletedAt?: Date;
    scheduledHardDeleteAt?: Date;
    completedAt?: Date;
    errorMessage?: string;
    createdAt: Date;
}
//# sourceMappingURL=lgpd.interface.d.ts.map