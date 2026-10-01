import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CycletlsTransport } from '../src/transport/cycletlsTransport';
import { TmnVoucher } from '../src/client/tmnVoucher';
import type { TmnHttpRequest } from '../src/types';

// Spawns the real CycleTLS child process but only talks to a server on 127.0.0.1 (no external network).
// Set TMN_SKIP_CYCLETLS=1 to skip on machines where the bundled binary cannot run.
const suite = process.env.TMN_SKIP_CYCLETLS ? describe.skip : describe;

let server: Server;
let base: string;
const seen: IncomingMessage[] = [];

beforeAll(async () => {
    server = createServer((req, res) => {
        if (req.url?.startsWith('/slow')) {
            return;
        }
        seen.push(req);
        req.resume();
        req.on('end', () => {
            res.setHeader('Set-Cookie', ['sid=abc123; Path=/; HttpOnly', 'theme=dark']);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: { code: 'SUCCESS', message: 'ok' }, data: { amount: 50 } }));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

const req = (path: string, overrides: Partial<TmnHttpRequest> = {}): TmnHttpRequest => ({
    url: `${base}${path}`,
    body: '{"mobile":"0812345678"}',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    headerOrder: ['user-agent', 'accept', 'content-type'],
    timeoutSeconds: 5,
    ...overrides,
});

suite('CycletlsTransport against the real CycleTLS process', () => {
    it('sends the configured UA, replays Set-Cookie on the next request, and closes cleanly', async () => {
        seen.length = 0;
        const transport = new CycletlsTransport();
        try {
            const first = await transport.post(req('/redeem'));
            expect(first.status).toBe(200);
            expect(JSON.parse(first.body).status.code).toBe('SUCCESS');

            await transport.post(req('/redeem'));

            expect(seen).toHaveLength(2);
            expect(seen[0]!.headers['user-agent']).toBe(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0',
            );
            expect(seen[0]!.headers.cookie).toBeUndefined();
            expect(seen[1]!.headers.cookie).toContain('sid=abc123');
            expect(seen[1]!.headers.cookie).toContain('theme=dark');
        } finally {
            await transport.close();
        }
    }, 30_000);

    it('reports a request timeout as TIMEOUT', async () => {
        const transport = new CycletlsTransport();
        try {
            await expect(transport.post(req('/slow', { timeoutSeconds: 1 }))).rejects.toMatchObject({ code: 'TIMEOUT' });
        } finally {
            await transport.close();
        }
    }, 30_000);

    it('reports a refused connection as TRANSPORT_ERROR', async () => {
        const transport = new CycletlsTransport();
        try {
            await expect(transport.post({ ...req('/'), url: 'http://127.0.0.1:1/x' })).rejects.toMatchObject({
                code: 'TRANSPORT_ERROR',
            });
        } finally {
            await transport.close();
        }
    }, 30_000);

    it('can be closed and a fresh transport started afterwards (close/reuse lifecycle)', async () => {
        const a = new CycletlsTransport();
        await a.post(req('/redeem'));
        await a.close();
        await expect(a.post(req('/redeem'))).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });

        const b = new CycletlsTransport();
        try {
            expect((await b.post(req('/redeem'))).status).toBe(200);
        } finally {
            await b.close();
        }
    }, 30_000);

    it('survives rapid open/use/close cycles without delay (no startup race)', async () => {
        for (let i = 0; i < 4; i++) {
            const transport = new CycletlsTransport();
            expect((await transport.post(req('/redeem'))).status).toBe(200);
            await transport.close();
        }
    }, 60_000);

    it('close() lets an in-flight request finish instead of hanging it', async () => {
        const transport = new CycletlsTransport();
        const inFlight = transport.post(req('/slow', { timeoutSeconds: 1 })).catch((e: unknown) => e);
        await new Promise((resolve) => setTimeout(resolve, 300));

        await transport.close();

        expect(await inFlight).toMatchObject({ code: 'TIMEOUT' });
    }, 30_000);

    it('TmnVoucher with an injected baseUrl redeems through the default CycletlsTransport', async () => {
        const client = new TmnVoucher({ baseUrl: base, timeoutMs: 5000 });
        try {
            const result = await client.redeem('0812345678', 'ABCD1234EFGH', 50);
            expect(result.amount).toBe(50);
        } finally {
            await client.close();
        }
    }, 30_000);
});
