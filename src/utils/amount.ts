import type { TrueMoneyVoucherData } from '../types';

export function extractAmount(data: unknown): number | null {
    if (typeof data !== 'object' || data === null) {
        return null;
    }
    const d = data as TrueMoneyVoucherData;
    const voucher = typeof d.voucher === 'object' && d.voucher !== null ? d.voucher : {};

    for (const candidate of [d.amount, d.amount_baht, voucher.amount, voucher.amount_baht]) {
        const value = toAmount(candidate);
        if (value !== null) {
            return value;
        }
    }
    return null;
}

function toAmount(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? round2(value) : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim().replace(/,/g, '');
        if (trimmed === '') {
            return null;
        }
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? round2(parsed) : null;
    }
    return null;
}

export function round2(value: number): number {
    const shifted = Number(`${value}e2`);
    if (!Number.isFinite(shifted)) {
        return Math.round(value * 100) / 100;
    }
    return Number(`${Math.round(shifted)}e-2`);
}

export function amountsEqual(a: number, b: number): boolean {
    return Math.round(a * 100) === Math.round(b * 100);
}
