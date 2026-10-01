import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import initCycleTLS, { type CycleTLSClient, type CycleTLSResponse } from 'cycletls';
import { CookieJar } from './cookieJar';
import { TmnVoucherError } from '../errors';
import type { TmnHttpRequest, TmnHttpResponse, TmnLogLevel, TmnTransport, TmnVoucherOptions } from '../types';

export class CycletlsTransport implements TmnTransport {
    private readonly jar = new CookieJar();
    private readonly onLog?: (level: TmnLogLevel, message: string) => void;
    private client?: CycleTLSClient;
    private initPromise?: Promise<CycleTLSClient>;
    private readonly inFlight = new Set<Promise<unknown>>();
    private closing?: Promise<void>;
    private closed = false;

    constructor(private readonly options: TmnVoucherOptions = {}) {
        if (options.onLog) {
            const onLog = options.onLog;
            this.onLog = (level, message) => onLog(level, message);
        }
    }

    async post(request: TmnHttpRequest): Promise<TmnHttpResponse> {
        if (this.closed) {
            throw new TmnVoucherError('TRANSPORT_ERROR', 'transport is closed — create a new client');
        }

        const client = this.client ?? (await this.ensureClient());
        if (this.closed) {
            throw new TmnVoucherError('TRANSPORT_ERROR', 'transport is closed — create a new client');
        }

        const pending = this.send(client, request);
        this.inFlight.add(pending);
        try {
            return await pending;
        } finally {
            this.inFlight.delete(pending);
        }
    }

    close(): Promise<void> {
        this.closed = true;
        this.closing ??= this.shutdown();
        return this.closing;
    }

    private async shutdown(): Promise<void> {
        let client = this.client;
        if (!client && this.initPromise) {
            client = await this.initPromise.catch(() => undefined);
        }
        this.client = undefined;
        if (!client) {
            return;
        }

        // CycleTLS drops a client's listeners on exit(), which would leave an in-flight redeem hanging forever.
        await Promise.allSettled([...this.inFlight]);
        await releaseClient(client);
    }

    private async send(client: CycleTLSClient, request: TmnHttpRequest): Promise<TmnHttpResponse> {
        const resp = await client(
            request.url,
            {
                body: request.body,
                headers: request.headers,
                headerOrder: request.headerOrder,
                cookies: this.jar.forHost('gift.truemoney.com'),
                ja3:
                    this.options.ja3 ??
                    '771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-51-57-47-53-10,0-23-65281-10-11-35-16-5-51-43-13-45-28-21,29-23-24-25-256-257,0',
                http2Fingerprint:
                    this.options.http2Fingerprint ??
                    '1:65536;2:0;4:131072;5:16384|12517377|0|m,p,a,s',
                userAgent:
                    this.options.userAgent ??
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0',
                timeout: request.timeoutSeconds,
                responseType: 'text',
            },
            'post',
        );

        const headers: Record<string, unknown> = resp.headers ?? {};
        const body = this.normalizeBody(resp);

        const failure = describeTransportFailure(resp.status, headers, body);
        if (failure) {
            this.onLog?.('error', `transport request failed: ${failure.message}`);
            throw new TmnVoucherError(failure.code, `redeem request failed: ${failure.message}`);
        }

        this.jar.set(findHeader(headers, 'set-cookie'), 'gift.truemoney.com');

        return { status: resp.status, headers, body };
    }

    private ensureClient(): Promise<CycleTLSClient> {
        this.initPromise ??= this.startTransport();
        return this.initPromise;
    }

    private async startTransport(): Promise<CycleTLSClient> {
        try {
            await shutdownGate;
            const executablePath = await this.prepareExecutable();
            const init = initCycleTLS({
                timeout: 15_000,
                ...(executablePath ? { executablePath } : {}),
                ...(this.options.autoExit ? { autoExit: true } : {}),
            }).then((client) => {
                liveClients++;
                return client;
            });

            let client: CycleTLSClient;
            try {
                client = await withTimeout(init, 20_000, 'browser-fingerprint transport did not become ready in time');
            } catch (err) {
                // A client that finishes starting after we gave up would otherwise keep its child process alive.
                void init.then(releaseClient, () => undefined);
                throw err;
            }

            if (this.closed) {
                await releaseClient(client);
                throw new TmnVoucherError('TRANSPORT_ERROR', 'transport is closed — create a new client');
            }
            this.client = client;
            return client;
        } catch (err) {
            if (!this.closed) {
                this.onLog?.('error', `failed to start browser-fingerprint transport: ${String(err)}`);
            }
            this.initPromise = undefined;
            throw err;
        }
    }

    private async prepareExecutable(): Promise<string | undefined> {
        const binary = (
            {
                linux: { x64: 'index', arm64: 'index-arm64', arm: 'index-arm' },
            } as Record<string, Record<string, string>>
        )[process.platform]?.[os.arch()];
        if (!binary) {
            return undefined;
        }
        try {
            const dest = path.join(os.tmpdir(), `tmnvoucher-${binary}`);
            try {
                await fs.access(dest, fs.constants.X_OK);
                return dest;
            } catch {
                await fs.copyFile(path.join(path.dirname(createRequire(import.meta.url).resolve('cycletls')), binary), dest);
                await fs.chmod(dest, 0o755);
                return dest;
            }
        } catch (err) {
            this.onLog?.(
                'debug',
                `could not prepare a writable transport binary, using the bundled one: ${String(err)}`,
            );
            return undefined;
        }
    }

    private normalizeBody(resp: CycleTLSResponse): string {
        return (typeof resp.data === 'string' ? resp.data : String(resp.data ?? '')).slice(0, this.options.maxBodyBytes ?? (2 << 20));
    }
}

// CycleTLS runs one shared child process (fixed WebSocket port) that is killed asynchronously after the last
// client exits. Starting a new client before the port is free fails (and poisons later inits), so after the last
// client is released the next startup waits until the port stops accepting connections.
const CYCLETLS_PORT = 9119;
let liveClients = 0;
let shutdownGate: Promise<void> = Promise.resolve();

async function releaseClient(client: CycleTLSClient): Promise<void> {
    try {
        await client.exit();
    } catch {
    }
    liveClients = Math.max(0, liveClients - 1);
    if (liveClients === 0) {
        shutdownGate = waitForPortRelease(CYCLETLS_PORT, 3_000);
    }
}

async function waitForPortRelease(port: number, maxMs: number): Promise<void> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline && (await isPortBusy(port))) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

function isPortBusy(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.connect({ port, host: 'localhost' });
        socket.setTimeout(500);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', () => resolve(false));
    });
}

function findHeader(headers: Record<string, unknown>, name: string): unknown {
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === name) {
            return headers[key];
        }
    }
    return undefined;
}

// CycleTLS resolves (instead of rejecting) when a request fails before an HTTP response exists:
// timeout -> 408, dial/TLS errors -> other 4xx/5xx, always with empty headers and the Go error text as body.
// A genuine upstream response always carries headers, so "no headers + error status" means transport failure.
function describeTransportFailure(
    status: unknown,
    headers: Record<string, unknown>,
    body: string,
): { code: 'TIMEOUT' | 'TRANSPORT_ERROR'; message: string } | undefined {
    if (Object.keys(headers).length > 0 || (typeof status === 'number' && status > 0 && status < 400)) {
        return undefined;
    }
    const message = redactVoucherPath(body.split('\n', 1)[0] ?? '')
        .replace(/->\s*$/, '')
        .trim()
        .slice(0, 300);
    const isTimeout = status === 408 || /deadline exceeded|timeout|timed out/i.test(body);
    return {
        code: isTimeout ? 'TIMEOUT' : 'TRANSPORT_ERROR',
        message: message === '' ? `transport failed with status ${String(status)}` : message,
    };
}

function redactVoucherPath(text: string): string {
    return text.replace(/\/vouchers\/[^/\s"]+/g, '/vouchers/****');
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            },
        );
    });
}
