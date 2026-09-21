import { extractAmount } from '../utils/amount';
import { TmnVoucherError, TmnVoucherUpstreamError } from '../errors';
import { maskCode, maskPhone } from '../utils/mask';
import { CycletlsTransport } from '../transport/cycletlsTransport';
import type { TmnTransport, TmnVoucherOptions, TmnVoucherResult, TrueMoneyEnvelope } from '../types';

interface CacheEntry {
    result: TmnVoucherResult;
    ts: number;
}

export class RedeemService {
    private readonly transport: TmnTransport;
    private readonly ownsTransport: boolean;
    private readonly baseUrl: string;
    private readonly timeoutSeconds: number;
    private readonly cacheTtlMs: number;
    private readonly cacheMax: number;
    private readonly headerOrder: string[];
    private readonly onLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;

    private readonly cache = new Map<string, CacheEntry>();
    private readonly inflight = new Map<string, Promise<TmnVoucherResult>>();

    constructor(options: TmnVoucherOptions = {}) {
        this.transport = options.transport ?? new CycletlsTransport(options);
        this.ownsTransport = options.transport === undefined;
        this.baseUrl = (options.baseUrl ?? 'https://gift.truemoney.com').replace(/\/+$/, '');
        this.timeoutSeconds = Math.max(1, Math.ceil((options.timeoutMs ?? 15_000) / 1000));
        this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60_000;
        this.cacheMax = options.cacheMax ?? 1024;
        this.headerOrder = options.headerOrder ?? [
            'user-agent',
            'accept',
            'accept-language',
            'accept-encoding',
            'content-type',
            'referer',
            'sec-fetch-dest',
            'sec-fetch-mode',
            'sec-fetch-site',
        ];
        if (options.onLog) {
            const onLog = options.onLog;
            this.onLog = (level, message) => onLog(level, message);
        }
    }

    async redeem(code: string, phone: string): Promise<TmnVoucherResult> {
        const key = `${code}|${phone}`;

        const cached = this.cacheGet(key);
        if (cached !== undefined) {
            return { ...cached, cached: true };
        }

        const pending = this.inflight.get(key);
        if (pending) {
            return pending;
        }

        const promise = this.doRedeem(code, phone, key);
        this.inflight.set(key, promise);
        promise.then(() => this.inflight.delete(key), () => this.inflight.delete(key));
        return promise;
    }

    async close(): Promise<void> {
        this.cache.clear();
        this.inflight.clear();
        if (this.ownsTransport) {
            await this.transport.close();
        }
    }

    private async doRedeem(code: string, phone: string, key: string): Promise<TmnVoucherResult> {
        let response;
        try {
            response = await this.transport.post({
                url: `${this.baseUrl}/campaign/vouchers/${encodeURIComponent(code)}/redeem`,
                body: JSON.stringify({ mobile: phone }),
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9',
                    Referer: 'https://gift.truemoney.com/campaign/card',
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'same-origin',
                },
                headerOrder: this.headerOrder,
                timeoutSeconds: this.timeoutSeconds,
            });
        } catch (err) {
            if (err instanceof TmnVoucherError) {
                throw err;
            }
            const message = err instanceof Error ? err.message : String(err);
            this.onLog?.('error', `redeem failed: ${message} code=${maskCode(code)} phone=${maskPhone(phone)}`);
            throw new TmnVoucherError(
                /timeout|timed out|deadline/i.test(message) ? 'TIMEOUT' : 'TRANSPORT_ERROR',
                `redeem request failed: ${message}`,
                { cause: err },
            );
        }

        const envelope = parseEnvelope(response.body, response.status, code);
        const status = envelope.status;

        if (status.code !== 'SUCCESS') {
            throw new TmnVoucherUpstreamError(status.code, status.message, response.status, envelope);
        }

        const result: TmnVoucherResult = {
            ok: true,
            amount: extractAmount(envelope.data),
            phone,
            code,
            status,
            data: envelope.data ?? null,
            envelope,
            cached: false,
        };

        this.cacheSet(key, result);
        return result;
    }

    private cacheGet(key: string): TmnVoucherResult | undefined {
        if (this.cacheTtlMs <= 0) {
            return undefined;
        }
        const entry = this.cache.get(key);
        if (!entry) {
            return undefined;
        }
        if (Date.now() - entry.ts > this.cacheTtlMs) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.result;
    }

    private cacheSet(key: string, result: TmnVoucherResult): void {
        if (this.cacheTtlMs <= 0) {
            return;
        }
        if (this.cache.size >= this.cacheMax) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
                this.cache.delete(oldest);
            }
        }
        this.cache.set(key, { result, ts: Date.now() });
    }
}

export function parseEnvelope(
    raw: string,
    status: number,
    code: string,
): TrueMoneyEnvelope {
    if (raw.length === 0) {
        if (status >= 200 && status < 300) {
            return { status: { code: 'SUCCESS', message: '' } };
        }
        throw new TmnVoucherError(
            'MALFORMED_RESPONSE',
            `TrueMoney returned HTTP ${status} with an empty body (code=${maskCode(code)})`,
        );
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new TmnVoucherError(
            'MALFORMED_RESPONSE',
            `TrueMoney returned HTTP ${status} with a non-JSON response: ${preview(raw)}`,
        );
    }

    const envelope = asEnvelope(parsed);
    if (envelope === undefined) {
        throw new TmnVoucherError(
            'MALFORMED_RESPONSE',
            status >= 400
                ? `upstream returned HTTP ${status} without a TrueMoney status envelope: ${preview(raw)}`
                : `upstream returned HTTP ${status} with an unexpected body: ${preview(raw)}`,
        );
    }

    return envelope;
}

function asEnvelope(value: unknown): TrueMoneyEnvelope | undefined {
    if (typeof value !== 'object' || value === null || !('status' in value)) {
        return undefined;
    }
    const status = (value as { status: unknown }).status;
    if (typeof status !== 'object' || status === null) {
        return undefined;
    }
    const { code, message } = status as { code?: unknown; message?: unknown };
    if (typeof code !== 'string') {
        return undefined;
    }
    return {
        status: { code, message: typeof message === 'string' ? message : '' },
        ...('data' in value ? { data: (value as { data?: unknown }).data } : {}),
    };
}

function preview(raw: string): string {
    return raw.length > 200 ? `${raw.slice(0, 200)}...` : raw;
}
