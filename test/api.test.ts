import { afterEach, describe, expect, it } from 'vitest';
import defaultExport, {
    createTmnVoucher,
    redeem,
    tmnVoucher,
    TmnVoucher,
    TmnVoucherAmountMismatchError,
    TmnVoucherUpstreamError,
    TmnVoucherValidationError,
    maskCode,
    maskPhone,
} from '../src/index';
import { errorEnvelope, json, MockTransport, successEnvelope } from './helpers';

const PHONE = '0812345678';
const CODE = 'ABCD1234EFGH';

afterEach(async () => {
    await tmnVoucher.close();
});

describe('public surface', () => {
    it('exposes the callable as both default and named export', () => {
        expect(typeof tmnVoucher).toBe('function');
        expect(defaultExport).toBe(tmnVoucher);
        expect(redeem).toBe(tmnVoucher);
    });

    it('attaches the helpers to the callable', () => {
        expect(typeof tmnVoucher.create).toBe('function');
        expect(typeof tmnVoucher.configure).toBe('function');
        expect(typeof tmnVoucher.close).toBe('function');
        expect(tmnVoucher.redeem).toBe(tmnVoucher);
        expect(tmnVoucher.TmnVoucher).toBe(TmnVoucher);
    });

    it('masks secrets in logs', () => {
        expect(maskCode('ABCD1234EFGH')).toBe('ABCD****EFGH');
        expect(maskCode('SHORT')).toBe('****');
        expect(maskPhone('0812345678')).toBe('081****78');
    });
});

describe('tmnVoucher(phone, gift, amount?)', () => {
    it('redeems through the shared client', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        tmnVoucher.configure({ transport });

        expect((await tmnVoucher(PHONE, CODE)).amount).toBe(50);
    });

    it('supports the optional third argument', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        tmnVoucher.configure({ transport });

        await expect(tmnVoucher(PHONE, CODE, 50)).resolves.toMatchObject({ amount: 50 });
        await expect(tmnVoucher(PHONE, CODE, 99)).rejects.toBeInstanceOf(TmnVoucherAmountMismatchError);
    });

    it('configure() replaces the shared client', async () => {
        const first = new MockTransport(() => json(successEnvelope(10)));
        const second = new MockTransport(() => json(successEnvelope(20)));

        tmnVoucher.configure({ transport: first });
        expect((await tmnVoucher(PHONE, CODE)).amount).toBe(10);

        tmnVoucher.configure({ transport: second });
        expect((await tmnVoucher(PHONE, CODE)).amount).toBe(20);
    });

    it('close() drops the shared client, which is rebuilt on demand', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        tmnVoucher.configure({ transport });

        await tmnVoucher(PHONE, CODE);
        await tmnVoucher.close();

        tmnVoucher.configure({ transport });
        expect((await tmnVoucher(PHONE, CODE)).amount).toBe(50);
        expect(transport.closed).toBe(false);
        expect(transport.calls).toHaveLength(2);
    });

    it('validates before touching the transport', async () => {
        const transport = new MockTransport(() => json(successEnvelope(50)));
        tmnVoucher.configure({ transport });

        await expect(tmnVoucher('bad-phone', CODE)).rejects.toBeInstanceOf(TmnVoucherValidationError);
        expect(transport.calls).toHaveLength(0);
    });
});

describe('createTmnVoucher', () => {
    it('returns an isolated client', async () => {
        const a = createTmnVoucher({
            transport: new MockTransport(() => json(successEnvelope(10))),
        });
        const b = createTmnVoucher({
            transport: new MockTransport(() => json(successEnvelope(20))),
        });

        expect((await a.redeem(PHONE, CODE)).amount).toBe(10);
        expect((await b.redeem(PHONE, CODE)).amount).toBe(20);

        await a.close();
        await b.close();
    });

    it('surfaces upstream errors with a stable code', async () => {
        const client = createTmnVoucher({
            transport: new MockTransport(() => json(errorEnvelope('VOUCHER_EXPIRED'), 400)),
        });

        await expect(client.redeem(PHONE, CODE)).rejects.toBeInstanceOf(
            TmnVoucherUpstreamError,
        );
        await client.close();
    });
});
