# Peek OCTO Connector

Sell a partner's tours on **your** Peek Pro booking page, with the bookings
landing in **their** Peek Pro dashboard.

```
Guest books "Partner Kayak Tour" on YOUR Peek page
        │  (OCTO booking webhook from your Peek account)
        ▼
  This connector ── looks up mappings.json ──► partner's Peek over OCTO:
                                               check availability → reserve → confirm
        ▲
        └── cancellations in your Peek are forwarded the same way
```

You keep a **copy ("mirror") product** of each partner tour in your Peek.
When a guest books one, the connector creates the same booking in your
partner's Peek and saves both reference numbers. Bookings for your own tours
are ignored.

The setup is symmetrical. If your partner wants to sell your tours too, they
run their own copy of this connector with your OCTO key.

## What you need from Peek

1. **An OCTO API key for your partner's account, issued to you as a reseller.**
   Your partner asks Peek to issue it. This is the step that decides whether
   the whole setup works.
2. **An OCTO API key for your own account,** so the connector can register a
   booking webhook. Ask Peek to confirm that webhooks fire for bookings made
   on your own booking page, not only for bookings made through OCTO. If they
   don't, use the fallback described under "Other ways to send bookings in".

## Setup

Requires Node.js 20+. There is nothing to install with npm.

```bash
cp .env.example .env                       # fill in keys and a long random INTAKE_USER/INTAKE_PASS
npm run list-products -- partner           # copy partner product/option/unit IDs
npm run list-products -- mine              # copy your mirror product/unit IDs
cp mappings.example.json mappings.json     # map each mirror product to the partner's
npm start                                  # deploy on any host with a public HTTPS URL
npm run register-webhook                   # once, after it's reachable at PUBLIC_URL
```

Run `npm run watch-availability` every ~15 minutes (cron / host scheduler). It
alerts you when a partner departure fills up or closes, so you can close the
same slot in your Peek.

## What happens when something goes wrong

| Situation | Result |
|---|---|
| Partner slot is full or closed when a guest books | Booking marked `FAILED`, and you get an alert to refund or rebook the guest |
| Partner API down | Connector returns a 5xx so the sender retries. Retrying is safe: it never double-books |
| Same notification delivered twice | Recognized as a duplicate and ignored |
| Guest changes date/guests after forwarding | Alert asks you to update the booking in the partner's Peek by hand (v1) |
| Cancellation fails at partner | Booking marked `CANCEL_FAILED`, and you get an alert |

Alerts go to the log and, if set, to `ALERT_WEBHOOK_URL` (Slack, Zapier, etc.).
`GET /bookings` (basic auth) shows every forwarded booking and its status.

## Other ways to send bookings in

If Peek's webhook doesn't cover your use, anything that can send an HTTP
request can forward bookings: Zapier, Make, an email parser, or a person.
Send them to `POST /intake/booking` with basic auth:

```json
{
  "sourceBookingId": "your Peek booking ref",
  "productId": "YOUR-MIRROR-PRODUCT-ID",
  "start": "2026-12-05T09:00",
  "units": [{ "unitId": "Adult", "quantity": 2 }],
  "contact": { "fullName": "Jane Guest", "emailAddress": "jane@example.com", "phoneNumber": "+15555550100" }
}
```

Cancel with `POST /intake/cancel` `{ "sourceBookingId": "..." }`.

## Testing without real keys

`npm test` runs the full flow against two fake Peek accounts (`mock/`).
`npm run mock` starts one fake account on port 4001 for manual testing.

## Things to agree with your partner

- **Money.** OCTO only places the booking. The guest pays you. Settle the
  partner's share (net rate or commission) between yourselves, for example
  with a monthly invoice built from `GET /bookings`.
- **Who emails the guest.** The connector sets `emailReceipt: false`, so only
  your confirmation email goes out.
- **Prices and descriptions** on your mirror products are set by hand in your
  Peek.
