import { describe, expect, it } from 'vitest';
import { amountsEqual, extractAmount, round2 } from '../src/utils/amount';

describe('extractAmount', () => {
    it('reads data.amount', () => {
        expect(extractAmount({ amount: 50 })).toBe(50);
    });

    it('reads data.voucher.amount', () => {
        expect(extractAmount({ voucher: { amount: 100 } })).toBe(100);
    });

    it('reads the amount_baht string aliases', () => {
        expect(extractAmount({ amount_baht: '25.50' })).toBe(25.5);
        expect(extractAmount({ voucher: { amount_baht: '1,000.00' } })).toBe(1000);
    });

    it('returns null when nothing numeric is present', () => {
        expect(extractAmount({})).toBeNull();
        expect(extractAmount(null)).toBeNull();
        expect(extractAmount('50')).toBeNull();
        expect(extractAmount({ amount: 'unknown' })).toBeNull();
        expect(extractAmount({ amount: Number.NaN })).toBeNull();
    });

    it('rounds to two decimals', () => {
        expect(extractAmount({ amount: 50.005 })).toBe(50.01);
    });
});

describe('amountsEqual', () => {
    it('tolerates float noise', () => {
        expect(amountsEqual(50, 50)).toBe(true);
        expect(amountsEqual(50, 50.0)).toBe(true);
        expect(amountsEqual(0.1 + 0.2, 0.3)).toBe(true);
    });

    it('separates different values', () => {
        expect(amountsEqual(50, 51)).toBe(false);
        expect(amountsEqual(50, 50.5)).toBe(false);
    });
});

describe('round2', () => {
    it('rounds half up', () => {
        expect(round2(1.005)).toBe(1.01);
        expect(round2(1.004)).toBe(1);
    });
});
