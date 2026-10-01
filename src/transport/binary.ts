import { promises as fs, type Stats } from 'node:fs';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';

const POSIX = process.platform !== 'win32';

// Copies the bundled CycleTLS binary somewhere writable/executable (e.g. read-only node_modules on serverless).
// The target lives in a private per-user directory, is never a predictable shared path in a world-writable
// tmpdir (another local user could plant a binary there), and is written via temp file + rename.
export async function prepareWritableBinary(
    source: string,
    tmpRoot: string,
    name: string,
    uid: number | undefined = process.getuid?.(),
): Promise<string> {
    const dir = path.join(tmpRoot, uid === undefined ? 'tmnvoucher' : `tmnvoucher-${uid}`);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    if (POSIX && uid !== undefined) {
        const stat = await fs.lstat(dir);
        if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
            throw new Error(`unsafe transport directory ${dir}`);
        }
    }

    const dest = path.join(dir, name);
    const { size } = await fs.stat(source);
    if (await isReusable(dest, size, uid)) {
        return dest;
    }

    const tmp = `${dest}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
        await fs.copyFile(source, tmp, fs.constants.COPYFILE_EXCL);
        await fs.chmod(tmp, 0o700);
        await fs.rename(tmp, dest);
    } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
    }
    return dest;
}

async function isReusable(dest: string, size: number, uid: number | undefined): Promise<boolean> {
    let stat: Stats;
    try {
        stat = await fs.lstat(dest);
    } catch {
        return false;
    }
    if (!stat.isFile() || stat.size !== size) {
        return false;
    }
    if (POSIX) {
        if (uid !== undefined && stat.uid !== uid) {
            return false;
        }
        if ((stat.mode & 0o022) !== 0 || (stat.mode & 0o100) === 0) {
            return false;
        }
    }
    return true;
}
