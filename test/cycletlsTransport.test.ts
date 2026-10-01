import { beforeEach, describe, expect, it, vi } from 'vitest';
import initCycleTLS from 'cycletls';
import { CycletlsTransport } from '../src/transport/cycletlsTransport';
import { RedeemService } from '../src/redeem/redeemService';
import { TmnVoucher } from '../src/client/tmnVoucher';
import { TmnVoucherError } from '../src/errors';
import type { TmnHttpRequest } from '../src/types';
import { errorEnvelope, successEnvelope } from './helpers';

vi.mock('cycletls', () => ({ default: vi.fn() }));

const initMock = vi.mocked(initCycleTLS);

interface FakeResponse {
    status: number;
    headers: Record<string, unknown>;
    data: unknown;
}

function fakeClient(handler: (url: string, options: Record<string, unknown>, method: string) => FakeResponse) {
    const client = Object.assign(
        vi.fn(async (url: string, options: Record<string, unknown>, method: string) => handler(url, options, method)),
        { exit: vi.fn(async () => undefined) },
    );
    initMock.mockResolvedValue(client as never);
    return client;
}

function request(overrides: Partial<TmnHttpRequest> = {}): TmnHttpRequest {
    return {
        url: 'https://gift.truemoney.com/campaign/vouchers/ABCD1234EFGH/redeem',
        body: '{"mobile":"0812345678"}',
        headers: { 'Content-Type': 'application/json' },
        headerOrder: ['user-agent', 'accept'],
        timeoutSeconds: 15,
        ...overrides,
    };
}

const ok = (body: unknown = successEnvelope(50), headers: Record<string, unknown> = { 'Content-Type': ['application/json'] }): FakeResponse => ({
    status: 200,
    headers,
    data: JSON.stringify(body),
});

beforeEach(() => {
    initMock.mockReset();
});

describe('CycletlsTransport — default transport', () => {
    it('RedeemService defaults to CycletlsTransport and owns it', () => {
        const service = new RedeemService();
        expect((service as unknown as { transport: unknown }).transport).toBeInstanceOf(CycletlsTransport);
        expect((service as unknown as { ownsTransport: boolean }).ownsTransport).toBe(true);
    });

    it('TmnVoucher without options uses the CycletlsTransport', () => {
        const client = new TmnVoucher();
        const service = (client as unknown as { service: { transport: unknown } }).service;
        expect(service.transport).toBeInstanceOf(CycletlsTransport);
    });
});

describe('CycletlsTransport — fingerprint and request options', () => {
    it('sends the Firefox JA3 / HTTP2 fingerprint / User-Agent defaults', async () => {
        const client = fakeClient(() => ok());
        const transport = new CycletlsTransport();

        await transport.post(request());

        const [url, options, method] = client.mock.calls[0]!;
        expect(url).toBe(request().url);
        expect(method).toBe('post');
        expect(options).toMatchObject({
            ja3: '771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-51-57-47-53-10,0-23-65281-10-11-35-16-5-51-43-13-45-28-21,29-23-24-25-256-257,0',
            http2Fingerprint: '1:65536;2:0;4:131072;5:16384|12517377|0|m,p,a,s',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0',
            responseType: 'text',
            timeout: 15,
            body: '{"mobile":"0812345678"}',
            headerOrder: ['user-agent', 'accept'],
            headers: { 'Content-Type': 'application/json' },
        });
        await transport.close();
    });

    it('lets options override ja3 / http2Fingerprint / userAgent', async () => {
        const client = fakeClient(() => ok());
        const transport = new CycletlsTransport({ ja3: 'JA3', http2Fingerprint: 'H2', userAgent: 'UA' });

        await transport.post(request());

        expect(client.mock.calls[0]![1]).toMatchObject({ ja3: 'JA3', http2Fingerprint: 'H2', userAgent: 'UA' });
        await transport.close();
    });

    it('truncates the body to maxBodyBytes', async () => {
        fakeClient(() => ok('x'.repeat(100)));
        const transport = new CycletlsTransport({ maxBodyBytes: 10 });

        const res = await transport.post(request());

        expect(res.body).toHaveLength(10);
        await transport.close();
    });

    it('reuses one CycleTLS client across requests and across concurrent first calls', async () => {
        fakeClient(() => ok());
        const transport = new CycletlsTransport();

        await Promise.all([transport.post(request()), transport.post(request())]);
        await transport.post(request());

        expect(initMock).toHaveBeenCalledTimes(1);
        await transport.close();
    });
});

describe('CycletlsTransport — CookieJar', () => {
    it.each(['Set-Cookie', 'set-cookie', 'SET-COOKIE'])('stores cookies from a "%s" response header and replays them', async (headerName) => {
        const client = fakeClient((_url, _options, _method) => ok(successEnvelope(50), { [headerName]: ['__cf_bm=abc; Path=/; HttpOnly', 'sid=1'] }));
        const transport = new CycletlsTransport();

        await transport.post(request());
        expect(client.mock.calls[0]![1]).toMatchObject({ cookies: {} });

        await transport.post(request());
        expect(client.mock.calls[1]![1]).toMatchObject({ cookies: { __cf_bm: 'abc', sid: '1' } });
        await transport.close();
    });

    it('accepts a single string Set-Cookie value', async () => {
        const client = fakeClient(() => ok(successEnvelope(50), { 'Set-Cookie': 'a=1; Path=/' }));
        const transport = new CycletlsTransport();

        await transport.post(request());
        await transport.post(request());

        expect(client.mock.calls[1]![1]).toMatchObject({ cookies: { a: '1' } });
        await transport.close();
    });

    it('does not break when the response has no headers object', async () => {
        fakeClient(() => ({ status: 200, headers: undefined as never, data: '{}' }));
        const transport = new CycletlsTransport();

        await expect(transport.post(request())).resolves.toMatchObject({ status: 200, body: '{}' });
        await transport.close();
    });
});

describe('CycletlsTransport — failures reported as resolved responses', () => {
    const timeoutBody =
        'Request timeout: deadline exceeded-> \nPost "https://gift.truemoney.com/campaign/vouchers/ABCD1234EFGH/redeem": context deadline exceeded (Client.Timeout exceeded while awaiting headers)';
    const refusedBody =
        'Request returned a Syscall Error: connectex: No connection could be made because the target machine actively refused it.-> \nPost "https://gift.truemoney.com/campaign/vouchers/ABCD1234EFGH/redeem": dial tcp 1.2.3.4:443: connectex: refused';

    it('maps a cycletls timeout (408, no headers) to TIMEOUT', async () => {
        fakeClient(() => ({ status: 408, headers: {}, data: timeoutBody }));
        const transport = new CycletlsTransport();

        const err = await transport.post(request()).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(TmnVoucherError);
        expect((err as TmnVoucherError).code).toBe('TIMEOUT');
        await transport.close();
    });

    it('maps other cycletls failures (no headers) to TRANSPORT_ERROR', async () => {
        fakeClient(() => ({ status: 401, headers: {}, data: refusedBody }));
        const transport = new CycletlsTransport();

        const err = await transport.post(request()).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(TmnVoucherError);
        expect((err as TmnVoucherError).code).toBe('TRANSPORT_ERROR');
        await transport.close();
    });

    it('does not leak the voucher code in the error message', async () => {
        fakeClient(() => ({ status: 408, headers: {}, data: timeoutBody }));
        const transport = new CycletlsTransport();

        const err = (await transport.post(request()).catch((e: unknown) => e)) as Error;

        expect(err.message).not.toContain('ABCD1234EFGH');
        await transport.close();
    });

    it('passes through a real upstream error response that has headers', async () => {
        fakeClient(() => ({ status: 403, headers: { 'Content-Type': ['text/html'] }, data: '<html>Just a moment...</html>' }));
        const transport = new CycletlsTransport();

        await expect(transport.post(request())).resolves.toMatchObject({ status: 403, body: '<html>Just a moment...</html>' });
        await transport.close();
    });

    it('passes through a real upstream JSON error envelope', async () => {
        fakeClient(() => ({ status: 400, headers: { Date: ['x'] }, data: JSON.stringify(errorEnvelope('VOUCHER_EXPIRED')) }));
        const transport = new CycletlsTransport();

        await expect(transport.post(request())).resolves.toMatchObject({ status: 400 });
        await transport.close();
    });

    it('end to end: a timeout through TmnVoucher surfaces as TIMEOUT, not MALFORMED_RESPONSE', async () => {
        fakeClient(() => ({ status: 408, headers: {}, data: timeoutBody }));
        const client = new TmnVoucher();

        await expect(client.redeem('0812345678', 'ABCD1234EFGH')).rejects.toMatchObject({ code: 'TIMEOUT' });
        await client.close();
    });
});
