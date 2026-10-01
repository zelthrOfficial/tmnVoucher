# tmnVoucher

Redeem TrueMoney gift vouchers from Node.js with one function call.

[ไทย](README.th.md) | **English**

tmnVoucher validates the input, sends the redeem request with a Firefox-like TLS and HTTP/2 fingerprint so it gets past Cloudflare, and returns a typed result or a typed error. Successes are cached and concurrent duplicate calls share a single request.

## Contents

- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [API](#api)
- [Options](#options)
- [Result](#result)
- [Errors](#errors)
- [Custom transport](#custom-transport)
- [How it works](#how-it-works)
- [Lifecycle](#lifecycle)
- [Development](#development)
- [License](#license)

## Features

- One call: `tmnVoucher(phone, gift, amount?)`, or an isolated client when you need your own options
- Accepts a raw voucher code or the full `gift.truemoney.com` campaign link
- Optional expected amount guard that never hides a redemption that already happened
- Browser-like fingerprint (JA3, HTTP/2, User-Agent, header order) through CycleTLS, all overridable
- Built-in cookie jar, request timeout, and a transport you can replace for testing
- Success cache plus in-flight de-duplication per `code|phone`
- Stable error codes, with voucher codes and phone numbers masked in logs

## Install

The library is shipped as source. Copy `src/` into your project (for example `lib/tmnvoucher/`) and install its only runtime dependency:

```bash
npm i cycletls
```

Requires Node.js 18 or newer. `cycletls` is licensed under GPL-3.0, so check that this fits your distribution before redistributing.

## Quick start

```ts
import { tmnVoucher } from './lib/tmnvoucher/index.js';

try {
    const result = await tmnVoucher('0812345678', 'https://gift.truemoney.com/campaign/?v=ABC123');
    console.log(result.amount); // e.g. 50
} finally {
    await tmnVoucher.close();
}
```

Always call `close()` when you are done. The default transport runs a child process that otherwise keeps Node alive.

## API

### `tmnVoucher(phone, gift, amount?)`

Also available as `tmnVoucher.redeem(...)`, the named export `redeem`, and the default export.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `phone` | `string` | Thai mobile number: 10 digits starting with `0`. Spaces and dashes are removed. |
| `gift` | `string` | A raw code (letters, digits, `-`, `_`, up to 128 characters) or a full `https://gift.truemoney.com/campaign/?v=<code>` link. |
| `amount` | `number \| string` | Optional expected amount in THB. A string must be a plain decimal such as `"50"` or `"1,000.50"`. |

Returns `Promise<TmnVoucherResult>`.

If `amount` is given and differs from what TrueMoney reports, the call throws `AMOUNT_MISMATCH`. A redeemed voucher cannot be undone, so the error carries the real redemption in `err.result`.

### `createTmnVoucher(options?)` and `new TmnVoucher(options?)`

Create an isolated client with its own options, cache, and transport.

```ts
import { createTmnVoucher } from './lib/tmnvoucher/index.js';

const client = createTmnVoucher({ timeoutMs: 20_000 });
try {
    await client.redeem('0812345678', 'ABC123', 50);
} finally {
    await client.close();
}
```

### `tmnVoucher.configure(options?)`

Replaces the shared default client with one built from `options`. The previous client is closed in the background, after its in-flight requests finish.

### `tmnVoucher.close()` and `client.close()`

Releases the transport and clears the cache. Safe to call more than once. See [Lifecycle](#lifecycle).

### Other exports

`CycletlsTransport`, `RedeemService`, `CookieJar`, `extractAmount`, `amountsEqual`, `round2`, `normalizeGift`, `normalizePhone`, `maskCode`, `maskPhone`, the error classes, and the types `TmnTransport`, `TmnHttpRequest`, `TmnHttpResponse`, `TmnVoucherOptions`, `TmnVoucherResult`, `TmnLogLevel`, `TrueMoneyEnvelope`, `TrueMoneyStatus`, and `TrueMoneyVoucherData`.

## Options

All options are optional.

| Option | Default | Description |
| ------ | ------- | ----------- |
| `timeoutMs` | `15000` | Request timeout. Rounded up to whole seconds, minimum 1 second. |
| `cacheTtlMs` | `600000` | How long a successful result is cached. `0` disables the cache. |
| `cacheMax` | `1024` | Maximum cache entries. The oldest entry is evicted first. |
| `baseUrl` | `https://gift.truemoney.com` | Base URL of the redeem API. |
| `userAgent` | Firefox 148 on Windows | User-Agent sent by the default transport. |
| `ja3` | Firefox JA3 string | TLS fingerprint used by the default transport. |
| `http2Fingerprint` | Firefox HTTP/2 string | HTTP/2 fingerprint used by the default transport. |
| `headerOrder` | Firefox header order | Order in which request headers are sent. |
| `transport` | `CycletlsTransport` | Your own `TmnTransport`. See [Custom transport](#custom-transport). |
| `maxBodyBytes` | `2097152` | Maximum response body length kept by the default transport. |
| `autoExit` | `false` | Passed to CycleTLS to let it exit automatically with the process. |
| `onLog` | none | `(level, message, meta?) => void`. Receives `debug`, `info`, `warn`, and `error` messages. |

## Result

```ts
interface TmnVoucherResult {
    ok: true;
    amount: number | null; // THB, rounded to 2 decimals; null if TrueMoney reported none
    phone: string;         // normalized phone
    code: string;          // normalized voucher code
    status: { code: string; message: string };
    data: unknown;         // raw "data" from TrueMoney
    envelope: unknown;     // full TrueMoney response
    cached: boolean;       // true when replayed from the cache
}
```

## Errors

Every error extends `TmnVoucherError` and has a stable `.code`.

| Code | Meaning | Extra fields |
| ---- | ------- | ------------ |
| `INVALID_PHONE` | Phone is not 10 digits starting with `0`. | `field` |
| `INVALID_GIFT` | Code or link is empty, malformed, too long, or not a TrueMoney campaign link. | `field` |
| `INVALID_AMOUNT` | Expected amount is not a positive number. | `field` |
| `AMOUNT_MISMATCH` | Redeemed, but the amount differs from the expected one. | `expected`, `actual`, `result` |
| `AMOUNT_UNKNOWN` | Redeemed, but TrueMoney reported no amount to compare. | |
| `UPSTREAM_ERROR` | TrueMoney rejected the request, for example `VOUCHER_EXPIRED`. | `upstreamCode`, `upstreamMessage`, `httpStatus`, `envelope` |
| `MALFORMED_RESPONSE` | Empty or unexpected response, such as a Cloudflare challenge page. | |
| `TRANSPORT_ERROR` | Connection or startup failure, or the transport was already closed. | `cause` when available |
| `TIMEOUT` | The request exceeded `timeoutMs`. | |

Input is validated before any network request. Errors are never cached.

```ts
import { tmnVoucher, TmnVoucherAmountMismatchError, TmnVoucherUpstreamError } from './lib/tmnvoucher/index.js';

try {
    await tmnVoucher('0812345678', 'ABC123', 50);
} catch (err) {
    if (err instanceof TmnVoucherUpstreamError) {
        console.error(err.upstreamCode, err.upstreamMessage);
    } else if (err instanceof TmnVoucherAmountMismatchError) {
        console.error(`expected ${err.expected}, got ${err.actual}`, err.result);
    } else {
        throw err;
    }
}
```

## Custom transport

Implement `TmnTransport` to replace the network layer, for example in tests. A transport you pass in is never closed by the library, so you own its lifecycle.

```ts
import { createTmnVoucher, type TmnTransport } from './lib/tmnvoucher/index.js';

const transport: TmnTransport = {
    async post(request) {
        // request: { url, body, headers, headerOrder, timeoutSeconds }
        return {
            status: 200,
            headers: {},
            body: JSON.stringify({ status: { code: 'SUCCESS', message: '' }, data: { amount: 50 } }),
        };
    },
    async close() {},
};

const client = createTmnVoucher({ transport });
```

## How it works

- **Fingerprint.** Cloudflare in front of TrueMoney expects a real browser handshake. The default `CycletlsTransport` uses CycleTLS with a Firefox JA3 string, HTTP/2 fingerprint, User-Agent, and header order. These defaults live in `src/transport/` and `src/redeem/` and can be overridden through options.
- **Cookies.** A built-in cookie jar stores `Set-Cookie` values for `gift.truemoney.com` and replays them on later requests. It honors `Domain`, `Max-Age`, and `Expires`, and rejects cookies for domains the host does not belong to.
- **Caching.** A successful redeem is cached for 10 minutes per `code|phone` pair.
- **De-duplication.** Concurrent calls for the same `code|phone` share one request.
- **Failures.** Timeouts and connection errors reported by CycleTLS are mapped to `TIMEOUT` and `TRANSPORT_ERROR` instead of being mistaken for a bad response.

## Lifecycle

- The CycleTLS child process starts on the first request.
- `close()` waits for requests that are still in flight, then releases the process. It is idempotent.
- After `close()`, the same client rejects new requests with `TRANSPORT_ERROR`. Create a new client, or call `tmnVoucher.configure()`, to continue.
- Closing and starting again right away is safe. The transport waits for the CycleTLS port to be released before a new client starts.
- On Linux, the bundled CycleTLS binary is copied into a private per-user directory under the system temp folder so it can run from read-only installs.

## Development

The repository contains a `package.json` for development only. Consumers still copy `src/`.

```bash
npm ci
npm test            # unit tests and integration tests
npm run typecheck
```

The integration tests start the real CycleTLS process but only talk to a server on `127.0.0.1`, so they use no external network. Set `TMN_SKIP_CYCLETLS=1` to skip them on machines where the bundled binary cannot run. Do not use real vouchers in automated tests.

## License

MIT, copyright 2026 @zelthrOfficial. See [LICENSE](LICENSE).
