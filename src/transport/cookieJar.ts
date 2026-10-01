interface StoredCookie {
    name: string;
    value: string;
    domain: string;
    expiresAt?: number;
}

export class CookieJar {
    private readonly cookies = new Map<string, StoredCookie>();

    set(setCookieHeader: unknown, requestHost: string): void {
        if (!setCookieHeader) {
            return;
        }
        for (const raw of Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]) {
            this.setOne(String(raw), requestHost);
        }
    }

    forHost(host: string): Record<string, string> {
        const target = host.toLowerCase();
        const now = Date.now();
        const out: Record<string, string> = {};
        for (const [key, { name, value, domain, expiresAt }] of this.cookies) {
            if (expiresAt !== undefined && expiresAt <= now) {
                this.cookies.delete(key);
                continue;
            }
            if (target === domain || target.endsWith('.' + domain)) {
                out[name] = value;
            }
        }
        return out;
    }

    clear(): void {
        this.cookies.clear();
    }

    private setOne(header: string, requestHost: string): void {
        const parts = header.split(';').map((p) => p.trim()).filter((p) => p.length > 0);
        if (parts.length === 0) {
            return;
        }

        const first = parts[0]!;
        const eq = first.indexOf('=');
        if (eq <= 0) {
            return;
        }
        const name = first.slice(0, eq).trim();
        const value = first.slice(eq + 1).trim();

        const host = requestHost.toLowerCase();
        let domain = host;
        let maxAge: number | undefined;
        let expires: number | undefined;
        for (const attr of parts.slice(1)) {
            const [k, ...rest] = attr.split('=').map((s) => s.trim());
            const attrName = k?.toLowerCase();
            const attrValue = rest.join('=');
            if (attrName === 'domain' && rest.length > 0) {
                domain = attrValue.replace(/^\./, '').toLowerCase();
            } else if (attrName === 'max-age' && /^-?\d+$/.test(attrValue)) {
                maxAge = Number(attrValue);
            } else if (attrName === 'expires') {
                const time = Date.parse(attrValue);
                expires = Number.isNaN(time) ? undefined : time;
            }
        }

        // RFC 6265: a server may only set cookies for its own host or a parent domain (never a bare TLD).
        if (domain !== host && (!domain.includes('.') || !host.endsWith('.' + domain))) {
            return;
        }

        const key = `${domain}:${name}`;
        const expiresAt = maxAge !== undefined ? Date.now() + maxAge * 1000 : expires;
        if (value === '' || (expiresAt !== undefined && expiresAt <= Date.now())) {
            this.cookies.delete(key);
            return;
        }
        this.cookies.set(key, { name, value, domain, ...(expiresAt !== undefined ? { expiresAt } : {}) });
    }
}
