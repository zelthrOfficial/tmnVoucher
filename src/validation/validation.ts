import { TmnVoucherValidationError } from '../errors';

export function normalizeGift(raw: unknown): string {
    if (typeof raw !== 'string') {
        throw new TmnVoucherValidationError('gift', 'gift must be a string (voucher code or gift link)');
    }

    let voucher = raw.trim();
    if (voucher === '') {
        throw new TmnVoucherValidationError('gift', 'gift code is required');
    }

    if (voucher.includes('://')) {
        let parsed: URL;
        try {
            parsed = new URL(voucher);
        } catch {
            throw new TmnVoucherValidationError('gift', 'invalid gift URL');
        }
        if (
            parsed.protocol !== 'https:' ||
            parsed.hostname.toLowerCase() !== 'gift.truemoney.com' ||
            parsed.pathname !== '/campaign/'
        ) {
            throw new TmnVoucherValidationError('gift', 'invalid gift URL — expected https://gift.truemoney.com/campaign/?v=<code>');
        }
        voucher = parsed.searchParams.get('v') ?? '';
        if (voucher === '') {
            throw new TmnVoucherValidationError('gift', 'gift URL is missing the ?v=<code> parameter');
        }
    }

    if (voucher.length > 128) {
        throw new TmnVoucherValidationError('gift', 'gift code is too long');
    }

    for (const char of voucher) {
        const c = char.charCodeAt(0);
        const isAlpha = (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
        const isDigit = c >= 48 && c <= 57;
        if (!isAlpha && !isDigit && char !== '-' && char !== '_') {
            throw new TmnVoucherValidationError('gift', 'gift code may only contain letters, digits, "-" and "_"');
        }
    }

    return voucher;
}

export function normalizePhone(raw: unknown): string {
    if (typeof raw !== 'string') {
        throw new TmnVoucherValidationError('phone', 'phone must be a string of 10 digits starting with 0');
    }

    const phone = String(raw).trim().replace(/[\s-]/g, '');
    if (phone.length !== 10 || phone[0] !== '0') {
        throw new TmnVoucherValidationError('phone', 'phone must be 10 digits and start with 0');
    }
    for (const char of phone) {
        if (char < '0' || char > '9') {
            throw new TmnVoucherValidationError('phone', 'phone must be 10 digits and start with 0');
        }
    }
    return phone;
}
