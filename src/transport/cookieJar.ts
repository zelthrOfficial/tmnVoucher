interface StoredCookie {
    name: string;
    value: string;
    domain: string;
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
        const out: Record<string, string> = {};
        for (const { name, value, domain } of this.cookies.values()) {
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

        let domain = requestHost.toLowerCase();
        for (const attr of parts.slice(1)) {
            const [k, ...rest] = attr.split('=').map((s) => s.trim());
            if (k !== undefined && k.toLowerCase() === 'domain' && rest.length > 0) {
                domain = rest.join('=').replace(/^\./, '').toLowerCase();
                break;
            }
        }

        const key = `${domain}:${name}`;
        if (value === '') {
            this.cookies.delete(key);
            return;
        }
        this.cookies.set(key, { name, value, domain });
    }
}
