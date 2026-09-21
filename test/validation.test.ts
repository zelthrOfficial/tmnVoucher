import { describe, expect, it } from 'vitest';
import { TmnVoucherValidationError } from '../src/errors';
import { normalizeGift, normalizePhone } from '../src/validation/validation';

describe('normalizeGift', () => {
    it('accepts a raw code and trims it', () => {
        expect(normalizeGift('  ABC123_-  ')).toBe('ABC123_-');
    });

    it('extracts the code from a campaign link', () => {
        expect(normalizeGift('https://gift.truemoney.com/campaign/?v=ABCD1234EFGH')).toBe('ABCD1234EFGH');
    });

    it('ignores extra query parameters', () => {
        expect(normalizeGift('https://gift.truemoney.com/campaign/?utm=x&v=CODE1&z=2')).toBe('CODE1');
    });

    it('rejects other hosts, schemes and paths', () => {
        const bad = [
            'http://gift.truemoney.com/campaign/?v=CODE1',
            'https://evil.example/campaign/?v=CODE1',
            'https://gift.truemoney.com.evil.example/campaign/?v=CODE1',
            'https://gift.truemoney.com/campaign/card?v=CODE1',
        ];
        for (const value of bad) {
            expect(() => normalizeGift(value)).toThrow(TmnVoucherValidationError);
        }
    });

    it('rejects a link without ?v=', () => {
        expect(() =>
            normalizeGift('https://gift.truemoney.com/campaign/'),
        ).toThrow(/missing the \?v=/);
    });

    it('rejects empty, oversized and illegal characters', () => {
        expect(() => normalizeGift('   ')).toThrow(/required/);
        expect(() => normalizeGift('A'.repeat(129))).toThrow(/too long/);
        expect(() => normalizeGift('CODE/../etc')).toThrow(/may only contain/);
        expect(() => normalizeGift('CODE 123')).toThrow(/may only contain/);
    });

    it('rejects non-strings', () => {
        expect(() => normalizeGift(12345 as unknown as string)).toThrow(/must be a string/);
    });

    it('reports field=gift and code=INVALID_GIFT', () => {
        try {
            normalizeGift('');
            expect.unreachable();
        } catch (err) {
            expect(err).toBeInstanceOf(TmnVoucherValidationError);
            expect((err as TmnVoucherValidationError).code).toBe('INVALID_GIFT');
            expect((err as TmnVoucherValidationError).field).toBe('gift');
        }
    });
});

describe('normalizePhone', () => {
    it('strips spaces and dashes', () => {
        expect(normalizePhone('081-234-5678')).toBe('0812345678');
        expect(normalizePhone(' 081 234 5678 ')).toBe('0812345678');
    });

    it('rejects a number input — a leading zero cannot survive as a number', () => {
        expect(() => normalizePhone(812345678 as unknown as string)).toThrow(
            /must be a string/,
        );
    });

    it('rejects wrong length or prefix', () => {
        expect(() => normalizePhone('812345678')).toThrow(/start with 0/);
        expect(() => normalizePhone('081234567')).toThrow(/10 digits/);
        expect(() => normalizePhone('08123456789')).toThrow(/10 digits/);
    });

    it('rejects non-digits', () => {
        expect(() => normalizePhone('08123456ab')).toThrow(/10 digits/);
    });

    it('reports field=phone and code=INVALID_PHONE', () => {
        try {
            normalizePhone('123');
            expect.unreachable();
        } catch (err) {
            expect((err as TmnVoucherValidationError).code).toBe('INVALID_PHONE');
            expect((err as TmnVoucherValidationError).field).toBe('phone');
        }
    });
});
