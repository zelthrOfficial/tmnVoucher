# tmnVoucher

redeem gift TrueMoney จาก Node โดยตรง

**ไทย** - [English](README.md)

## ใช้งาน

1. ก๊อป `src/` ไปใส่โปรเจกต์ (เช่น `lib/tmnvoucher/`)
2. `npm i cycletls` (dependency ตัวเดียวที่ต้องใช้)

```ts
import { tmnVoucher } from './lib/tmnvoucher/index.js';

const r = await tmnVoucher('0812345678', 'https://gift.truemoney.com/campaign/?v=ABC123');
console.log(r.amount);

await tmnVoucher.close();
```

```
tmnVoucher(เบอร์, ลิงก์หรือโค้ด, ยอดที่คาดหวัง?)
```

| พารามิเตอร์ | คำอธิบาย |
| ---------- | -------- |
| `phone` | เบอร์ไทย 10 หลัก ขึ้นต้นด้วย `0` |
| `gift` | โค้ดดิบ (`A-Za-z0-9-_`, ≤ 128 ตัว) หรือลิงก์เต็ม |
| `amount` | ยอดที่คาดหวัง (optional) ถ้าไม่ตรงจะ throw `AMOUNT_MISMATCH` แต่ `err.result` ยังเก็บยอดจริงไว้ เพราะ redeem gift ย้อนกลับไม่ได้ |

แบบกำหนด option เอง:

```ts
import { createTmnVoucher } from './lib/tmnvoucher/index.js';

const client = createTmnVoucher({ timeoutMs: 20_000 });
await client.redeem('0812345678', 'ABC123', 50);
await client.close();
```

ใช้เสร็จ `close()` ทุกครั้ง — transport เปิด child process ค้างไว้ ถ้าไม่ปิด Node จะไม่จบ

## ผลลัพธ์

```ts
{ ok: true, amount: number | null, phone, code, status, data, envelope, cached }
```

## Error

ทุกตัวสืบทอดจาก `TmnVoucherError` มี `.code` คงที่: `INVALID_PHONE` · `INVALID_GIFT` · `INVALID_AMOUNT` · `AMOUNT_MISMATCH` (มี `.expected` / `.actual` / `.result`) · `AMOUNT_UNKNOWN` · `UPSTREAM_ERROR` (มี `.upstreamCode` เช่น `VOUCHER_EXPIRED`) · `MALFORMED_RESPONSE` · `TRANSPORT_ERROR` · `TIMEOUT`

## หมายเหตุ

- จำผลสำเร็จ 10 นาทีต่อ `code|phone` เรียกพร้อมกันแชร์ request เดียว error ไม่จำ
- Cloudflare ต้องใช้ handshake แบบ Firefox — JA3/H2/User-Agent/ลำดับ header hardcode ไว้ใน `transport/` + `redeem/` แต่ส่งผ่าน option ได้
- `cycletls` สัญญาอนุญาต GPL-3.0 — เช็กก่อนแจกจ่าย

## ทดสอบ

```bash
npx --no-install vitest run     # 64 ข้อ ไม่แตะเน็ต
npx --no-install tsc --noEmit   # ตรวจ type
```

Node ≥ 18 MIT © 2026 zelthrStudio — ดู [LICENSE](LICENSE)
