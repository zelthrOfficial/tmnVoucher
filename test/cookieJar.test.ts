import { afterEach, describe, expect, it, vi } from 'vitest';
import { CookieJar } from '../src/transport/cookieJar';

describe('CookieJar', () => {
    it('stores a cookie for the request host', () => {
        const jar = new CookieJar();
        jar.set('cf_clearance=abc; Path=/; HttpOnly', 'gift.truemoney.com');
        expect(jar.forHost('gift.truemoney.com')).toEqual({ cf_clearance: 'abc' });
    });

    it('honours an explicit Domain attribute, stripping the leading dot', () => {
        const jar = new CookieJar();
        jar.set('sess=1; Domain=.truemoney.com', 'gift.truemoney.com');
        expect(jar.forHost('gift.truemoney.com')).toEqual({ sess: '1' });
        expect(jar.forHost('api.truemoney.com')).toEqual({ sess: '1' });
        expect(jar.forHost('example.com')).toEqual({});
    });

    it('does not leak cookies to unrelated hosts', () => {
        const jar = new CookieJar();
        jar.set('sess=1', 'gift.truemoney.com');
        expect(jar.forHost('evil.example')).toEqual({});
        expect(jar.forHost('notgift.truemoney.com')).toEqual({});
    });

    it('accepts an array of Set-Cookie headers', () => {
        const jar = new CookieJar();
        jar.set(['a=1', 'b=2'], 'gift.truemoney.com');
        expect(jar.forHost('gift.truemoney.com')).toEqual({ a: '1', b: '2' });
    });

    it('removes a cookie when the value is empty', () => {
        const jar = new CookieJar();
        jar.set('a=1', 'gift.truemoney.com');
        jar.set('a=; Max-Age=0', 'gift.truemoney.com');
        expect(jar.forHost('gift.truemoney.com')).toEqual({});
    });

    it('ignores malformed headers instead of throwing', () => {
        const jar = new CookieJar();
        expect(() => jar.set('garbage', 'gift.truemoney.com')).not.toThrow();
        expect(() => jar.set('', 'gift.truemoney.com')).not.toThrow();
        expect(() => jar.set(undefined, 'gift.truemoney.com')).not.toThrow();
        expect(jar.forHost('gift.truemoney.com')).toEqual({});
    });

    it('clear() empties the jar', () => {
        const jar = new CookieJar();
        jar.set('a=1', 'gift.truemoney.com');
        jar.clear();
        expect(jar.forHost('gift.truemoney.com')).toEqual({});
    });

    describe('Domain validation', () => {
        it('rejects a Domain the request host does not belong to', () => {
            const jar = new CookieJar();
            jar.set('x=1; Domain=evil.example', 'gift.truemoney.com');
            jar.set('y=1; Domain=other.truemoney.com', 'gift.truemoney.com');
            expect(jar.forHost('gift.truemoney.com')).toEqual({});
            expect(jar.forHost('evil.example')).toEqual({});
        });

        it('rejects a bare top-level Domain such as "com"', () => {
            const jar = new CookieJar();
            jar.set('x=1; Domain=com', 'gift.truemoney.com');
            jar.set('y=1; Domain=.com', 'gift.truemoney.com');
            expect(jar.forHost('gift.truemoney.com')).toEqual({});
        });

        it('accepts the exact host as Domain', () => {
            const jar = new CookieJar();
            jar.set('x=1; Domain=gift.truemoney.com', 'gift.truemoney.com');
            expect(jar.forHost('gift.truemoney.com')).toEqual({ x: '1' });
        });

        it('is case-insensitive', () => {
            const jar = new CookieJar();
            jar.set('x=1; Domain=.TrueMoney.COM', 'Gift.TrueMoney.com');
            expect(jar.forHost('gift.truemoney.com')).toEqual({ x: '1' });
        });
    });

    describe('expiry', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('deletes an existing cookie on Max-Age=0 even when the value is non-empty', () => {
            const jar = new CookieJar();
            jar.set('a=1', 'gift.truemoney.com');
            jar.set('a=1; Max-Age=0', 'gift.truemoney.com');
            expect(jar.forHost('gift.truemoney.com')).toEqual({});
        });

        it('deletes an existing cookie on a negative Max-Age', () => {
            const jar = new CookieJar();
            jar.set('a=1', 'gift.truemoney.com');
            jar.set('a=1; Max-Age=-1', 'gift.truemoney.com');
            expect(jar.forHost('gift.truemoney.com')).toEqual({});
        });

        it('deletes an existing cookie when Expires is in the past', () => {
            const jar = new CookieJar();
            jar.set('a=1', 'gift.truemoney.com');
            jar.set('a=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'gift.truemoney.com');
            expect(jar.forHost('gift.truemoney.com')).toEqual({});
        });

        it('stops sending a cookie after its Max-Age elapses', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            const jar = new CookieJar();
            jar.set('a=1; Max-Age=60', 'gift.truemoney.com');
            expect(jar.forHost('gift.truemoney.com')).toEqual({ a: '1' });

            vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
            expect(jar.forHost('gift.truemoney.com')).toEqual({});
        });

        it('stops sending a cookie after its Expires date', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            const jar = new CookieJar();
            jar.set('a=1; Expires=Thu, 01 Jan 2026 00:10:00 GMT', 'gift.truemoney.com');
            expect(jar.forHost('gift.truemoney.com')).toEqual({ a: '1' });

            vi.setSystemTime(new Date('2026-01-01T00:10:01Z'));
            expect(jar.forHost('gift.truemoney.com')).toEqual({});
        });

        it('Max-Age wins over Expires', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            const jar = new CookieJar();
            jar.set('a=1; Max-Age=3600; Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'gift.truemoney.com');
            expect(jar.forHost('gift.truemoney.com')).toEqual({ a: '1' });
        });

        it('keeps session cookies and ignores an unparsable Expires', () => {
            const jar = new CookieJar();
            jar.set('a=1; Expires=not-a-date', 'gift.truemoney.com');
            jar.set('b=2; Max-Age=abc', 'gift.truemoney.com');
            expect(jar.forHost('gift.truemoney.com')).toEqual({ a: '1', b: '2' });
        });
    });
});
