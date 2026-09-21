# tmnVoucher

Redeem TrueMoney gift vouchers straight from Node.

[ไทย](README.th.md) - **English**

## Use

1. Copy `src/` into your project (e.g. `lib/tmnvoucher/`)
2. `npm i cycletls` (only runtime dep)

```ts
import { tmnVoucher } from './lib/tmnvoucher/index.js';

const r = await tmnVoucher('0812345678', 'https://gift.truemoney.com/campaign/?v=ABC123');
console.log(r.amount);

await tmnVoucher.close();
```

```
tmnVoucher(phone, gift link or code, amount?)
```

| Param | Description |
| ----- | ----------- |
| `phone` | Thai mobile, 10 digits starting with `0` |
| `gift` | Raw code (`A-Za-z0-9-_`, ≤ 128) or full campaign link |
| `amount` | Optional expected THB. Mismatch throws `AMOUNT_MISMATCH`, but `err.result` keeps the real redemption because a redeem gift cannot be undone |

With options:

```ts
import { createTmnVoucher } from './lib/tmnvoucher/index.js';

const client = createTmnVoucher({ timeoutMs: 20_000 });
await client.redeem('0812345678', 'ABC123', 50);
await client.close();
```

Always `close()` when done — the transport spawns a child process that keeps Node alive.

## Result

```ts
{ ok: true, amount: number | null, phone, code, status, data, envelope, cached }
```

## Errors

All extend `TmnVoucherError` with a stable `.code`: `INVALID_PHONE` · `INVALID_GIFT` · `INVALID_AMOUNT` · `AMOUNT_MISMATCH` (has `.expected` / `.actual` / `.result`) · `AMOUNT_UNKNOWN` · `UPSTREAM_ERROR` (has `.upstreamCode`, e.g. `VOUCHER_EXPIRED`) · `MALFORMED_RESPONSE` · `TRANSPORT_ERROR` · `TIMEOUT`

## Notes

- Successes are cached 10 min per `code|phone`; concurrent calls share one request; errors are never cached.
- Cloudflare needs a Firefox handshake — JA3/H2/User-Agent/header order are hardcoded in `transport/` + `redeem/`, overridable via options.
- `cycletls` is GPL-3.0 — check before redistributing.

## Test

```bash
npx --no-install vitest run     # 64 tests, no network
npx --no-install tsc --noEmit   # typecheck
```

Node ≥ 18. MIT © 2026 zelthrStudio — see [LICENSE](LICENSE).
