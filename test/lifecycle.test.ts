import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import initCycleTLS from 'cycletls';
import { CycletlsTransport } from '../src/transport/cycletlsTransport';
import { RedeemService } from '../src/redeem/redeemService';
import { TmnVoucher, tmnVoucher } from '../src/client/tmnVoucher';
import type { TmnHttpRequest } from '../src/types';
import { json, MockTransport, successEnvelope, tick } from './helpers';

vi.mock('cycletls', () => ({ default: vi.fn() }));

const initMock = vi.mocked(initCycleTLS);

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (err: unknown) => void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

type FakeClient = ReturnType<typeof makeClient>;

function makeClient(onRequest?: () => Promise<unknown>) {
    return Object.assign(
        vi.fn(async () => {
            if (onRequest) {
                await onRequest();
            }
            return { status: 200, headers: { Date: ['x'] }, data: '{}' };
        }),
        { exit: vi.fn(async () => undefined) },
    );
}

const asInit = (client: FakeClient) => client as never;

const request = (): TmnHttpRequest => ({
    url: 'https://gift.truemoney.com/campaign/vouchers/ABCD1234EFGH/redeem',
    body: '{}',
    headers: {},
    headerOrder: [],
    timeoutSeconds: 15,
});

beforeEach(() => {
    initMock.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('CycletlsTransport.close()', () => {
    it('does not start CycleTLS if it was never used', async () => {
        const transport = new CycletlsTransport();

        await transport.close();

        expect(initMock).not.toHaveBeenCalled();
    });

    it('exits the client exactly once even when close() is called repeatedly', async () => {
        const client = makeClient();
        initMock.mockResolvedValue(asInit(client));
        const transport = new CycletlsTransport();
        await transport.post(request());

        await transport.close();
        await transport.close();
        await Promise.all([transport.close(), transport.close()]);

        expect(client.exit).toHaveBeenCalledTimes(1);
    });

    it('rejects post() after close() with TRANSPORT_ERROR', async () => {
        initMock.mockResolvedValue(asInit(makeClient()));
        const transport = new CycletlsTransport();
        await transport.post(request());
        await transport.close();

        await expect(transport.post(request())).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });
    });

    it('still releases the client when close() is called while CycleTLS is starting', async () => {
        const client = makeClient();
        const init = deferred<FakeClient>();
        initMock.mockReturnValue(init.promise as never);
        const transport = new CycletlsTransport();

        const pendingPost = transport.post(request()).catch((e: unknown) => e);
        await tick();
        const closing = transport.close();
        init.resolve(client);
        await closing;
        const err = (await pendingPost) as { code?: string };

        expect(client.exit).toHaveBeenCalledTimes(1);
        expect(client).not.toHaveBeenCalled();
        expect(err.code).toBe('TRANSPORT_ERROR');
    });

    it('waits for an in-flight request before exiting the client', async () => {
        const gate = deferred<void>();
        const client = makeClient(() => gate.promise);
        initMock.mockResolvedValue(asInit(client));
        const transport = new CycletlsTransport();

        const inFlight = transport.post(request());
        await vi.waitFor(() => expect(client).toHaveBeenCalledTimes(1));

        let closed = false;
        const closing = transport.close().then(() => {
            closed = true;
        });
        await tick();
        expect(closed).toBe(false);
        expect(client.exit).not.toHaveBeenCalled();

        gate.resolve();
        await expect(inFlight).resolves.toMatchObject({ status: 200 });
        await closing;
        expect(client.exit).toHaveBeenCalledTimes(1);
    });

    it('does not throw when exit() fails', async () => {
        const client = makeClient();
        client.exit.mockRejectedValue(new Error('boom'));
        initMock.mockResolvedValue(asInit(client));
        const transport = new CycletlsTransport();
        await transport.post(request());

        await expect(transport.close()).resolves.toBeUndefined();
    });
});

describe('CycletlsTransport startup', () => {
    it('exits a client that becomes ready after the startup timeout', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100)); // let a previous test's port-release gate settle
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const client = makeClient();
        const init = deferred<FakeClient>();
        initMock.mockReturnValue(init.promise as never);
        const transport = new CycletlsTransport();

        const failed = transport.post(request()).catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(20_001);
        expect(String(await failed)).toContain('did not become ready in time');

        init.resolve(client);
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();

        expect(client.exit).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it('retries startup after a failed init', async () => {
        const client = makeClient();
        initMock.mockRejectedValueOnce(new Error('spawn failed')).mockResolvedValue(asInit(client));
        const transport = new CycletlsTransport();

        await expect(transport.post(request())).rejects.toThrow('spawn failed');
        await expect(transport.post(request())).resolves.toMatchObject({ status: 200 });

        await transport.close();
        expect(initMock).toHaveBeenCalledTimes(2);
    });
});

describe('RedeemService in-flight tracking', () => {
    it('a settled stale request does not evict a newer in-flight request for the same key', async () => {
        const first = deferred<ReturnType<typeof json>>();
        const second = deferred<ReturnType<typeof json>>();
        const transport = new MockTransport((_req, index) => (index === 0 ? first.promise : second.promise));
        const service = new RedeemService({ transport, cacheTtlMs: 0 });

        const a = service.redeem('ABCD1234EFGH', '0812345678');
        await tick();
        await service.close();
        const b = service.redeem('ABCD1234EFGH', '0812345678');
        await tick();
        expect(transport.calls).toHaveLength(2);

        first.resolve(json(successEnvelope(10)));
        await a;
        await tick();

        const c = service.redeem('ABCD1234EFGH', '0812345678');
        await tick();
        expect(transport.calls).toHaveLength(2);

        second.resolve(json(successEnvelope(10)));
        await Promise.all([b, c]);
    });
});

describe('tmnVoucher.configure()', () => {
    afterEach(async () => {
        vi.restoreAllMocks();
        await tmnVoucher.close();
    });

    it('closes the client it replaces so its transport is not leaked', async () => {
        const closeSpy = vi.spyOn(TmnVoucher.prototype, 'close');
        tmnVoucher.configure({ transport: new MockTransport(() => json(successEnvelope(1))) });
        expect(closeSpy).not.toHaveBeenCalled();

        tmnVoucher.configure({ transport: new MockTransport(() => json(successEnvelope(2))) });
        await tick();

        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('does not surface an error from closing the replaced client', async () => {
        vi.spyOn(TmnVoucher.prototype, 'close').mockRejectedValue(new Error('close failed'));
        tmnVoucher.configure({ transport: new MockTransport(() => json(successEnvelope(1))) });

        expect(() => tmnVoucher.configure({ transport: new MockTransport(() => json(successEnvelope(2))) })).not.toThrow();
        await tick();
    });

    it('still serves requests from the new configuration', async () => {
        tmnVoucher.configure({ transport: new MockTransport(() => json(successEnvelope(1))) });
        tmnVoucher.configure({ transport: new MockTransport(() => json(successEnvelope(7))) });

        expect((await tmnVoucher('0812345678', 'ABCD1234EFGH')).amount).toBe(7);
    });
});
