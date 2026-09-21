import { beforeEach, describe, expect, it } from 'vitest';
import {
    TmnVoucherAmountMismatchError,
    TmnVoucherError,
    TmnVoucherUpstreamError,
    TmnVoucherValidationError,
} from '../src/errors';
import { RedeemService } from '../src/redeem/redeemService';
import { TmnVoucher } from '../src/client/tmnVoucher';
import { errorEnvelope, json, MockTransport, successEnvelope } from './helpers';

const PHONE = '0812345678';
const CODE = 'ABCD1234EFGH';

function clientWith(transport: MockTransport, options = {}): TmnVoucher {
    return new TmnVoucher({ transport, ...options });
}

describe('TmnVoucher.redeem — happy path', () => {
    it('returns a normalized result', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        const result = await clientWith(transport).redeem(PHONE, CODE);

        expect(result.ok).toBe(true);
        expect(result.amount).toBe(50);
        expect(result.phone).toBe(PHONE);
        expect(result.code).toBe(CODE);
        expect(result.status.code).toBe('SUCCESS');
        expect(result.cached).toBe(false);
    });

    it('POSTs to the redeem endpoint with the mobile body', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        await clientWith(transport).redeem(PHONE, CODE);

        const call = transport.calls[0]!;
        expect(call.url).toBe(`https://gift.truemoney.com/campaign/vouchers/${CODE}/redeem`);
        expect(JSON.parse(call.body)).toEqual({ mobile: PHONE });
        expect(call.headers['Content-Type']).toBe('application/json');
        expect(call.headerOrder[0]).toBe('user-agent');
        expect(call.timeoutSeconds).toBe(15);
    });

    it('accepts a gift link and redeems the extracted code', async () => {
        const transport = new MockTransport(() => json(successEnvelope(20)));
        const result = await clientWith(transport).redeem(PHONE, `https://gift.truemoney.com/campaign/?v=${CODE}`);

        expect(result.code).toBe(CODE);
        expect(transport.calls[0]!.url).toContain(`/vouchers/${CODE}/redeem`);
    });

    it('honours a custom baseUrl and timeout', async () => {
        const transport = new MockTransport(() => json(successEnvelope(20)));
        await clientWith(transport, { baseUrl: 'https://example.test/', timeoutMs: 4_000 }).redeem(PHONE, CODE);

        expect(transport.calls[0]!.url).toBe(`https://example.test/campaign/vouchers/${CODE}/redeem`);
        expect(transport.calls[0]!.timeoutSeconds).toBe(4);
    });
});

describe('TmnVoucher.redeem — amount guard', () => {
    it('passes when the credited amount matches', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        const result = await clientWith(transport).redeem(PHONE, CODE, 50);
        expect(result.amount).toBe(50);
    });

    it('accepts a numeric string amount', async () => {
        const transport = new MockTransport(() => json(successEnvelope(25.5)));
        const result = await clientWith(transport).redeem(PHONE, CODE, '25.50');
        expect(result.amount).toBe(25.5);
    });

    it('throws AMOUNT_MISMATCH but still exposes the real result', async () => {
        const transport = new MockTransport(() => json(successEnvelope(20)));
        const client = clientWith(transport);

        await expect(client.redeem(PHONE, CODE, 50)).rejects.toBeInstanceOf(TmnVoucherAmountMismatchError);

        try {
            await client.redeem(PHONE, CODE, 50);
            expect.unreachable();
        } catch (err) {
            const mismatch = err as TmnVoucherAmountMismatchError;
            expect(mismatch.code).toBe('AMOUNT_MISMATCH');
            expect(mismatch.expected).toBe(50);
            expect(mismatch.actual).toBe(20);
            expect(mismatch.result.amount).toBe(20);
            expect(mismatch.result.ok).toBe(true);
        }
    });

    it('throws AMOUNT_UNKNOWN when upstream reports no amount', async () => {
        const transport = new MockTransport(() => json({ status: { code: 'SUCCESS', message: 'ok' }, data: {} }));
        try {
            await clientWith(transport).redeem(PHONE, CODE, 50);
            expect.unreachable();
        } catch (err) {
            expect((err as TmnVoucherError).code).toBe('AMOUNT_UNKNOWN');
        }
    });

    it('rejects a non-positive amount before any request', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        await expect(clientWith(transport).redeem(PHONE, CODE, 0)).rejects.toBeInstanceOf(TmnVoucherValidationError);
        await expect(clientWith(transport).redeem(PHONE, CODE, -5)).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
        expect(transport.calls).toHaveLength(0);
    });
});

describe('TmnVoucher.redeem — caching and single-flight', () => {
    it('replays a success from cache without a second upstream call', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        const client = clientWith(transport);

        expect((await client.redeem(PHONE, CODE)).cached).toBe(false);
        expect((await client.redeem(PHONE, CODE)).cached).toBe(true);
        expect(transport.calls).toHaveLength(1);
    });

    it('keys the cache by code AND phone', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        const client = clientWith(transport);

        await client.redeem(PHONE, CODE);
        await client.redeem('0899999999', CODE);
        await client.redeem(PHONE, 'OTHERCODE');

        expect(transport.calls).toHaveLength(3);
    });

    it('does not cache upstream errors', async () => {
        const transport = new MockTransport(() => json(errorEnvelope('VOUCHER_OUT_OF_STOCK'), 400));
        const client = clientWith(transport);

        await expect(client.redeem(PHONE, CODE)).rejects.toThrow();
        await expect(client.redeem(PHONE, CODE)).rejects.toThrow();
        expect(transport.calls).toHaveLength(2);
    });

    it('shares one in-flight call between concurrent callers', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => {
            release = r;
        });
        const transport = new MockTransport(async () => {
            await gate;
            return json(successEnvelope(50));
        });
        const client = clientWith(transport);

        const pending = [
            client.redeem(PHONE, CODE),
            client.redeem(PHONE, CODE),
            client.redeem(PHONE, CODE),
        ] as const;
        expect(transport.calls).toHaveLength(1);
        release();

        const [a, b, c] = await Promise.all(pending);

        expect(transport.calls).toHaveLength(1);
        expect(a.amount).toBe(50);
        expect(b.amount).toBe(50);
        expect(c.amount).toBe(50);
    });

    it('cacheTtlMs: 0 disables caching', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        const client = clientWith(transport, { cacheTtlMs: 0 });

        await client.redeem(PHONE, CODE);
        await client.redeem(PHONE, CODE);
        expect(transport.calls).toHaveLength(2);
    });

    it('evicts the oldest entry at cacheMax', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        const client = clientWith(transport, { cacheMax: 2 });

        await client.redeem(PHONE, 'CODE1');
        await client.redeem(PHONE, 'CODE2');
        await client.redeem(PHONE, 'CODE3');
        expect(transport.calls).toHaveLength(3);

        await client.redeem(PHONE, 'CODE2');
        expect(transport.calls).toHaveLength(3);
    });
});

describe('TmnVoucher.redeem — upstream and transport failures', () => {
    it('maps a domain error envelope to TmnVoucherUpstreamError', async () => {
        const transport = new MockTransport(() => json(errorEnvelope('TARGET_USER_NOT_FOUND', 'ไม่พบเบอร์'), 400));

        try {
            await clientWith(transport).redeem(PHONE, CODE);
            expect.unreachable();
        } catch (err) {
            const upstream = err as TmnVoucherUpstreamError;
            expect(upstream).toBeInstanceOf(TmnVoucherUpstreamError);
            expect(upstream.code).toBe('UPSTREAM_ERROR');
            expect(upstream.upstreamCode).toBe('TARGET_USER_NOT_FOUND');
            expect(upstream.httpStatus).toBe(400);
            expect(upstream.envelope).toMatchObject({
                status: { code: 'TARGET_USER_NOT_FOUND' },
            });
        }
    });

    it('maps a Cloudflare HTML challenge to MALFORMED_RESPONSE', async () => {
        const transport = new MockTransport(() => ({
            status: 403,
            headers: {},
            body: '<html><title>Just a moment...</title></html>',
        }));
        await expect(clientWith(transport).redeem(PHONE, CODE)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
    });

    it('maps an empty non-2xx body to MALFORMED_RESPONSE', async () => {
        const transport = new MockTransport(() => ({
            status: 502,
            headers: {},
            body: '',
        }));
        await expect(clientWith(transport).redeem(PHONE, CODE)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
    });

    it('maps a thrown transport error to TRANSPORT_ERROR', async () => {
        const transport = new MockTransport(() => { throw new Error('socket hang up'); });
        try {
            await clientWith(transport).redeem(PHONE, CODE);
            expect.unreachable();
        } catch (err) {
            expect((err as TmnVoucherError).code).toBe('TRANSPORT_ERROR');
            expect((err as TmnVoucherError).cause).toBeInstanceOf(Error);
        }
    });

    it('maps a timeout message to TIMEOUT', async () => {
        const transport = new MockTransport(() => { throw new Error('Request timeout after 15s'); });
        await expect(clientWith(transport).redeem(PHONE, CODE)).rejects.toMatchObject({ code: 'TIMEOUT' });
    });

    it('rejects before hitting the network when input is invalid', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        const client = clientWith(transport);

        await expect(client.redeem('123', CODE)).rejects.toMatchObject({ code: 'INVALID_PHONE' });
        await expect(client.redeem(PHONE, '')).rejects.toMatchObject({ code: 'INVALID_GIFT' });
        expect(transport.calls).toHaveLength(0);
    });
});

describe('TmnVoucher lifecycle', () => {
    it('close() clears the cache so the next call is a real request', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        const client = clientWith(transport);

        await client.redeem(PHONE, CODE);
        await client.close();

        await client.redeem(PHONE, CODE);
        expect(transport.calls).toHaveLength(2);
    });

    it('close() leaves an injected transport alone (ownership)', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        const client = clientWith(transport);

        await client.close();
        expect(transport.closed).toBe(false);
    });

    it('close() is idempotent', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        const client = clientWith(transport);
        await expect(client.close()).resolves.toBeUndefined();
        await expect(client.close()).resolves.toBeUndefined();
    });
});

describe('RedeemService', () => {
    it('is usable directly with normalized input', async () => {
        const transport = new MockTransport(() => json(successEnvelope(75)));
        const service = new RedeemService({ transport });
        const result = await service.redeem('RAWCODE', '0812345678');
        expect(result.amount).toBe(75);
        expect(result.code).toBe('RAWCODE');
    });

    it('url-encodes the code into the path', async () => {
        const transport = new MockTransport(() => json(successEnvelope(1)));
        const service = new RedeemService({ transport });
        await service.redeem('a b/c', '0812345678');
        expect(transport.calls[0]!.url).toContain('/vouchers/a%20b%2Fc/redeem');
    });
});
