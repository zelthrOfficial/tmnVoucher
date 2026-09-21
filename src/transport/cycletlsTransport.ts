import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
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

        this.client ??= await this.ensureClient();
        const resp = await this.client(
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

        this.jar.set(resp.headers['set-cookie'], 'gift.truemoney.com');

        return { status: resp.status, headers: resp.headers, body: this.normalizeBody(resp) };
    }

    async close(): Promise<void> {
        this.closed = true;
        if (this.client) {
            try {
                await this.client.exit();
            } catch {
            }
        }
    }

    private ensureClient(): Promise<CycleTLSClient> {
        this.initPromise ??= this.startTransport();
        return this.initPromise;
    }

    private async startTransport(): Promise<CycleTLSClient> {
        try {
            const executablePath = await this.prepareExecutable();
            return await withTimeout(
                initCycleTLS({
                    timeout: 15_000,
                    ...(executablePath ? { executablePath } : {}),
                    ...(this.options.autoExit ? { autoExit: true } : {}),
                }),
                20_000,
                'browser-fingerprint transport did not become ready in time',
            );
        } catch (err) {
            this.onLog?.('error', `failed to start browser-fingerprint transport: ${String(err)}`);
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
