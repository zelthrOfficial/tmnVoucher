import type {
    TmnHttpRequest,
    TmnHttpResponse,
    TmnTransport,
} from '../src/types';

export class MockTransport implements TmnTransport {
    readonly calls: TmnHttpRequest[] = [];
    closed = false;

    constructor(
        private readonly handler: (
            request: TmnHttpRequest,
            index: number,
        ) => Promise<TmnHttpResponse> | TmnHttpResponse,
    ) {}

    async post(request: TmnHttpRequest): Promise<TmnHttpResponse> {
        this.calls.push(request);
        return this.handler(request, this.calls.length - 1);
    }

    async close(): Promise<void> {
        this.closed = true;
    }
}

export function successEnvelope(amount: number, mobile = '081****678'): Record<string, unknown> {
    return {
        status: { code: 'SUCCESS', message: 'สำเร็จ' },
        data: {
            voucher: { voucher_id: 'vch_1', amount },
            amount,
            mobile,
            redeemed_at: 1_700_000_000,
        },
    };
}

export function errorEnvelope(code: string, message = 'failed'): Record<string, unknown> {
    return { status: { code, message } };
}

export function json(body: unknown, status = 200): TmnHttpResponse {
    return {
        status,
        headers: {},
        body: typeof body === 'string' ? body : JSON.stringify(body),
    };
}

export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
