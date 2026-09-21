export function maskCode(code: string): string {
    if (code.length <= 8) {
        return '****';
    }
    return code.slice(0, 4) + '****' + code.slice(-4);
}

export function maskPhone(phone: string): string {
    if (phone.length < 7) {
        return '****';
    }
    return phone.slice(0, 3) + '****' + phone.slice(-2);
}
