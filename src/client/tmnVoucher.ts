import { amountsEqual, round2 } from '../utils/amount';
import { TmnVoucherAmountMismatchError, TmnVoucherError, TmnVoucherValidationError } from '../errors';
import { RedeemService } from '../redeem/redeemService';
import type { TmnVoucherOptions, TmnVoucherResult } from '../types';
import { normalizeGift, normalizePhone } from '../validation/validation';

export class TmnVoucher {
    private readonly service: RedeemService;

    constructor(options: TmnVoucherOptions = {}) {
        this.service = new RedeemService(options);
    }

    async redeem(phone: string, gift: string, amount?: number | string): Promise<TmnVoucherResult> {
        const expected = normalizeAmount(amount);

        const result = await this.service.redeem(normalizeGift(gift), normalizePhone(phone));

        if (expected === undefined) {
            return result;
        }
        if (result.amount === null) {
            throw new TmnVoucherError(
                'AMOUNT_UNKNOWN',
                `redeemed successfully but TrueMoney reported no amount to compare against ${expected} THB`,
            );
        }
        if (!amountsEqual(expected, result.amount)) {
            throw new TmnVoucherAmountMismatchError(expected, result.amount, result);
        }
        return { ...result, amount: round2(result.amount) };
    }

    close(): Promise<void> {
        return this.service.close();
    }
}

export function createTmnVoucher(options?: TmnVoucherOptions): TmnVoucher {
    return new TmnVoucher(options);
}

function normalizeAmount(amount: number | string | undefined): number | undefined {
    if (amount === undefined || amount === null) {
        return undefined;
    }
    const value = typeof amount === 'string' ? Number(amount.trim().replace(/,/g, '')) : amount;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TmnVoucherValidationError('amount', 'amount must be a positive number of THB');
    }
    return round2(value);
}

let defaultClient: TmnVoucher | undefined;

function defaultInstance(): TmnVoucher {
    defaultClient ??= new TmnVoucher();
    return defaultClient;
}

function redeemWithDefaults(phone: string, gift: string, amount?: number | string): Promise<TmnVoucherResult> {
    return defaultInstance().redeem(phone, gift, amount);
}

export const tmnVoucher = Object.assign(redeemWithDefaults, {
    redeem: redeemWithDefaults,
    create: createTmnVoucher,
    configure(options?: TmnVoucherOptions): void {
        defaultClient = new TmnVoucher(options);
    },
    async close(): Promise<void> {
        const client = defaultClient;
        defaultClient = undefined;
        if (client) {
            await client.close();
        }
    },
    TmnVoucher,
});

export type { TmnVoucherResult, TmnVoucherOptions };
