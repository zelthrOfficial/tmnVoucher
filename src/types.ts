export interface TrueMoneyStatus {
    code: string;
    message: string;
}

export interface TrueMoneyEnvelope<TData = unknown> {
    status: TrueMoneyStatus;
    data?: TData;
}

export interface TrueMoneyVoucherData {
    amount?: number | string;
    amount_baht?: number | string;
    mobile?: string;
    redeemed_at?: number;
    voucher?: {
        voucher_id?: string;
        amount?: number | string;
        amount_baht?: number | string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface TmnVoucherResult {
    ok: true;
    amount: number | null;
    phone: string;
    code: string;
    status: TrueMoneyStatus;
    data: unknown;
    envelope: unknown;
    cached: boolean;
}

export interface TmnHttpRequest {
    url: string;
    body: string;
    headers: Record<string, string>;
    headerOrder: string[];
    timeoutSeconds: number;
}

export interface TmnHttpResponse {
    status: number;
    headers: Record<string, unknown>;
    body: string;
}

export interface TmnTransport {
    post(request: TmnHttpRequest): Promise<TmnHttpResponse>;
    close(): Promise<void>;
}

export type TmnLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface TmnVoucherOptions {
    timeoutMs?: number;
    cacheTtlMs?: number;
    cacheMax?: number;
    baseUrl?: string;
    userAgent?: string;
    ja3?: string;
    http2Fingerprint?: string;
    headerOrder?: string[];
    transport?: TmnTransport;
    maxBodyBytes?: number;
    autoExit?: boolean;
    onLog?: (level: TmnLogLevel, message: string, meta?: unknown) => void;
}
