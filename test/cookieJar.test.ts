import { describe, expect, it } from 'vitest';
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
});
