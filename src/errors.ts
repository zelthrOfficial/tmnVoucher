export type TmnVoucherErrorCode =
    | 'INVALID_PHONE'
    | 'INVALID_GIFT'
    | 'INVALID_AMOUNT'
    | 'AMOUNT_MISMATCH'
    | 'AMOUNT_UNKNOWN'
    | 'UPSTREAM_ERROR'
    | 'TRANSPORT_ERROR'
    | 'TIMEOUT'
    | 'MALFORMED_RESPONSE';

export class TmnVoucherError extends Error {
    readonly code: TmnVoucherErrorCode;

    constructor(code: TmnVoucherErrorCode, message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.code = code;
        this.name = new.target.name;
    }
}

const VALIDATION_CODES = { phone: 'INVALID_PHONE', gift: 'INVALID_GIFT', amount: 'INVALID_AMOUNT' } as const;

export class TmnVoucherValidationError extends TmnVoucherError {
    readonly field: 'phone' | 'gift' | 'amount';

    constructor(field: 'phone' | 'gift' | 'amount', message: string) {
        super(VALIDATION_CODES[field], message);
        this.field = field;
    }
}

export class TmnVoucherAmountMismatchError extends TmnVoucherError {
    readonly expected: number;
    readonly actual: number;
    readonly result: TmnVoucherResultLike;

    constructor(expected: number, actual: number, result: TmnVoucherResultLike) {
        super('AMOUNT_MISMATCH', `expected ${expected} THB but the voucher was worth ${actual} THB`);
        this.expected = expected;
        this.actual = actual;
        this.result = result;
    }
}

export class TmnVoucherUpstreamError extends TmnVoucherError {
    readonly upstreamCode: string;
    readonly upstreamMessage: string;
    readonly httpStatus: number;
    readonly envelope: unknown;

    constructor(upstreamCode: string, upstreamMessage: string, httpStatus: number, envelope: unknown) {
        super('UPSTREAM_ERROR', `${upstreamCode}: ${upstreamMessage}`);
        this.upstreamCode = upstreamCode;
        this.upstreamMessage = upstreamMessage;
        this.httpStatus = httpStatus;
        this.envelope = envelope;
    }
}

export interface TmnVoucherResultLike {
    ok: true;
    amount: number | null;
    phone: string;
    code: string;
    status: { code: string; message: string };
    data: unknown;
    envelope: unknown;
    cached: boolean;
}
