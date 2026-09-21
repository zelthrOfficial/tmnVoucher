import { tmnVoucher } from './client/tmnVoucher';

export { tmnVoucher, TmnVoucher, createTmnVoucher } from './client/tmnVoucher';
export { tmnVoucher as redeem };

export { CycletlsTransport } from './transport/cycletlsTransport';
export { RedeemService } from './redeem/redeemService';
export { CookieJar } from './transport/cookieJar';
export { extractAmount, amountsEqual, round2 } from './utils/amount';
export { normalizeGift, normalizePhone } from './validation/validation';
export { maskCode, maskPhone } from './utils/mask';

export {
    TmnVoucherError,
    TmnVoucherValidationError,
    TmnVoucherAmountMismatchError,
    TmnVoucherUpstreamError,
} from './errors';

export type { TmnVoucherErrorCode, TmnVoucherResultLike } from './errors';
export type {
    TmnHttpRequest,
    TmnHttpResponse,
    TmnLogLevel,
    TmnTransport,
    TmnVoucherOptions,
    TmnVoucherResult,
    TrueMoneyEnvelope,
    TrueMoneyStatus,
    TrueMoneyVoucherData,
} from './types';

export default tmnVoucher;
