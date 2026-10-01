import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareWritableBinary } from '../src/transport/binary';

let root: string;
let source: string;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tmnvoucher-test-'));
    source = path.join(root, 'bundled-index');
    await fs.writeFile(source, 'BINARY-V1');
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

const tmpRoot = () => path.join(root, 'tmp');

describe('prepareWritableBinary', () => {
    it('copies the bundled binary into a private per-user directory', async () => {
        await fs.mkdir(tmpRoot());

        const dest = await prepareWritableBinary(source, tmpRoot(), 'index', 1000);

        expect(path.dirname(dest)).toBe(path.join(tmpRoot(), 'tmnvoucher-1000'));
        expect(path.basename(dest)).toBe('index');
        expect(await fs.readFile(dest, 'utf8')).toBe('BINARY-V1');
    });

    it('does not use a predictable shared path', async () => {
        await fs.mkdir(tmpRoot());

        const dest = await prepareWritableBinary(source, tmpRoot(), 'index', 1000);

        expect(dest).not.toBe(path.join(tmpRoot(), 'tmnvoucher-index'));
    });

    it('reuses an existing copy of the same size', async () => {
        await fs.mkdir(tmpRoot());
        const first = await prepareWritableBinary(source, tmpRoot(), 'index', undefined);
        const before = await fs.stat(first);

        const second = await prepareWritableBinary(source, tmpRoot(), 'index', undefined);
        const after = await fs.stat(second);

        expect(second).toBe(first);
        expect(after.ino).toBe(before.ino);
        expect(after.mtimeMs).toBe(before.mtimeMs);
    });

    it('replaces a stale copy (e.g. after a cycletls upgrade changed the binary)', async () => {
        await fs.mkdir(tmpRoot());
        const dest = await prepareWritableBinary(source, tmpRoot(), 'index', undefined);
        await fs.writeFile(source, 'BINARY-V2-LONGER');

        const again = await prepareWritableBinary(source, tmpRoot(), 'index', undefined);

        expect(again).toBe(dest);
        expect(await fs.readFile(again, 'utf8')).toBe('BINARY-V2-LONGER');
    });

    it('leaves no temporary files behind', async () => {
        await fs.mkdir(tmpRoot());

        const dest = await prepareWritableBinary(source, tmpRoot(), 'index', undefined);
        await fs.writeFile(source, 'BINARY-V2-LONGER');
        await prepareWritableBinary(source, tmpRoot(), 'index', undefined);

        expect(await fs.readdir(path.dirname(dest))).toEqual(['index']);
    });

    it('fails (so the caller falls back to the bundled binary) when the source is missing', async () => {
        await fs.mkdir(tmpRoot());

        await expect(prepareWritableBinary(path.join(root, 'nope'), tmpRoot(), 'index', undefined)).rejects.toThrow();
    });

    it('cleans up the temporary file when the copy fails midway', async () => {
        await fs.mkdir(tmpRoot());
        const dir = path.join(tmpRoot(), 'tmnvoucher');
        await fs.mkdir(dir);
        // a directory at the destination makes the final rename fail
        await fs.mkdir(path.join(dir, 'index'));
        await fs.writeFile(path.join(dir, 'index', 'keep'), 'x');

        await expect(prepareWritableBinary(source, tmpRoot(), 'index', undefined)).rejects.toThrow();

        expect((await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });

    describe.skipIf(process.platform === 'win32')('ownership and permissions (POSIX)', () => {
        const uid = process.getuid?.() ?? 0;

        it('creates the directory and binary owner-only', async () => {
            await fs.mkdir(tmpRoot());

            const dest = await prepareWritableBinary(source, tmpRoot(), 'index', uid);

            expect((await fs.stat(path.dirname(dest))).mode & 0o077).toBe(0);
            expect((await fs.stat(dest)).mode & 0o777).toBe(0o700);
        });

        it('refuses a directory that is group/world accessible', async () => {
            await fs.mkdir(tmpRoot());
            const dir = path.join(tmpRoot(), `tmnvoucher-${uid}`);
            await fs.mkdir(dir);
            await fs.chmod(dir, 0o777);

            await expect(prepareWritableBinary(source, tmpRoot(), 'index', uid)).rejects.toThrow(/unsafe/);
        });

        it('refuses a symlinked directory', async () => {
            await fs.mkdir(tmpRoot());
            const elsewhere = path.join(root, 'elsewhere');
            await fs.mkdir(elsewhere);
            await fs.symlink(elsewhere, path.join(tmpRoot(), `tmnvoucher-${uid}`));

            await expect(prepareWritableBinary(source, tmpRoot(), 'index', uid)).rejects.toThrow(/unsafe/);
        });

        it('does not reuse a world-writable binary', async () => {
            await fs.mkdir(tmpRoot());
            const dest = await prepareWritableBinary(source, tmpRoot(), 'index', uid);
            await fs.writeFile(dest, 'BINARY-V1');
            await fs.chmod(dest, 0o777);

            const again = await prepareWritableBinary(source, tmpRoot(), 'index', uid);

            expect((await fs.stat(again)).mode & 0o022).toBe(0);
        });
    });
});
