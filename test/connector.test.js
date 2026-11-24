import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockOcto } from '../mock/mock-octo-server.js';
import { buildFromConfig } from '../src/server.js';
import { OctoClient } from '../src/octo-client.js';
import { BookingStore } from '../src/store.js';
import { checkAvailability } from '../scripts/watch-availability.js';

const listen = (server) => new Promise((r) => server.listen(0, () => r(`http://127.0.0.1:${server.address().port}`)));
const silent = { info() {}, warn() {}, error() {} };
const DATE = '2026-12-05';
const AUTH = 'Basic ' + Buffer.from('hook:s3cret').toString('base64');

let partner, mine, connector, partnerUrl, mineUrl, connectorUrl, store, alerts;

const mappings = {
  products: [{
    name: 'Partner Sunset Kayak',
    mine: { productId: 'my-mirror-kayak' },
    partner: { productId: 'kayak-tour', optionId: 'DEFAULT' },
    units: { 'my-adult': 'unit-adult', 'my-child': 'unit-child', Adult: 'unit-adult' },
  }],
};

before(async () => {
  partner = createMockOcto({ apiKey: 'partner-key', capacity: 4 });
  partnerUrl = await listen(partner.server);
  mine = createMockOcto({
    apiKey: 'my-key', capacity: 50,
    products: [
      { id: 'my-mirror-kayak', options: [{ id: 'DEFAULT', units: [{ id: 'my-adult' }, { id: 'my-child' }] }] },
      { id: 'my-own-tour', options: [{ id: 'DEFAULT', units: [{ id: 'my-adult' }] }] },
    ],
  });
  mineUrl = await listen(mine.server);

  store = new BookingStore(null);
  alerts = [];
  const config = {
    intake: { user: 'hook', pass: 's3cret' }, partner: { baseUrl: partnerUrl, apiKey: 'partner-key' }, mappings,
  };
  ({ app: connector } = buildFromConfig(config, {
    store, log: silent, notify: async (title, details) => alerts.push({ title, details }),
  }));
  connectorUrl = await listen(connector);

  // Register the connector as a webhook on "my" Peek, as scripts/register-webhook.js does.
  const hookUrl = new URL('/intake/octo-webhook', connectorUrl);
  hookUrl.username = 'hook'; hookUrl.password = 's3cret';
  await new OctoClient({ baseUrl: mineUrl, apiKey: 'my-key' }).createWebhook({ url: hookUrl.toString(), event: 'booking_update' });
});

after(() => { partner.server.close(); mine.server.close(); connector.close(); });

const guestBooks = (productId, time, unitItems) => fetch(`${mineUrl}/_simulate/direct-booking`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ productId, optionId: 'DEFAULT', availabilityId: `${DATE}T${time}:00-05:00`, unitItems, contact: { fullName: 'Jane Guest', emailAddress: 'jane@example.com', phoneNumber: '+15555550100' } }),
}).then((r) => r.json());

const partnerBookings = () => [...partner.state.bookings.values()];

test('a booking on my Peek page for a mirrored tour lands in the partner account', async () => {
  const mineBooking = await guestBooks('my-mirror-kayak', '09:00', [{ unitId: 'my-adult' }, { unitId: 'my-adult' }, { unitId: 'my-child' }]);
  const rec = store.get(mineBooking.uuid);
  assert.equal(rec.status, 'CONFIRMED');
  const pb = partnerBookings().find((b) => b.uuid === rec.partnerUuid);
  assert.equal(pb.status, 'CONFIRMED');
  assert.equal(pb.productId, 'kayak-tour');
  assert.equal(pb.availabilityId, `${DATE}T09:00:00-05:00`);
  assert.deepEqual(pb.unitItems.map((u) => u.unitId).sort(), ['unit-adult', 'unit-adult', 'unit-child']);
  assert.equal(pb.contact.fullName, 'Jane Guest');
  assert.equal(pb.resellerReference, mineBooking.uuid);
  assert.equal(rec.partnerReference, pb.supplierReference);
});

test('duplicate webhook deliveries do not double-book', async () => {
  const before = partnerBookings().length;
  const mineBooking = await guestBooks('my-mirror-kayak', '14:00', [{ unitId: 'my-adult' }]);
  const redeliver = () => fetch(`${connectorUrl}/intake/octo-webhook`, {
    method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ booking: mineBooking }),
  });
  await Promise.all([redeliver(), redeliver(), redeliver()]);
  assert.equal(partnerBookings().length, before + 1);
});

test('bookings for my own (non-partner) tours are ignored', async () => {
  const before = partnerBookings().length;
  const b = await guestBooks('my-own-tour', '09:00', [{ unitId: 'my-adult' }]);
  assert.equal(store.get(b.uuid).status, 'IGNORED');
  assert.equal(partnerBookings().length, before);
});

test('cancelling on my Peek cancels the partner booking', async () => {
  const b = await guestBooks('my-mirror-kayak', '14:00', [{ unitId: 'my-adult' }]);
  const partnerUuid = store.get(b.uuid).partnerUuid;
  await fetch(`${mineUrl}/_simulate/direct-cancel`, { method: 'POST', body: JSON.stringify({ uuid: b.uuid }) });
  assert.equal(store.get(b.uuid).status, 'CANCELLED');
  assert.equal(partner.state.bookings.get(partnerUuid).status, 'CANCELLED');
});

test('no partner availability -> booking marked FAILED and an alert is raised', async () => {
  alerts.length = 0;
  // 09:00 has 1 seat left at the partner (capacity 4, 3 booked above); ask for 2.
  const b = await guestBooks('my-mirror-kayak', '09:00', [{ unitId: 'my-adult' }, { unitId: 'my-adult' }]);
  const rec = store.get(b.uuid);
  assert.equal(rec.status, 'FAILED');
  assert.match(rec.error, /No availability/);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].title, /no availability/i);
});

test('generic intake accepts a normalized booking with unit names', async () => {
  const res = await fetch(`${connectorUrl}/intake/booking`, {
    method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceBookingId: 'ZAP-1', productId: 'my-mirror-kayak', start: '2026-12-06T14:00', units: [{ unitId: 'adult', quantity: 2 }], contact: { firstName: 'Sam', lastName: 'Lee' } }),
  });
  const rec = await res.json();
  assert.equal(res.status, 200);
  assert.equal(rec.status, 'CONFIRMED');
  assert.equal(partner.state.bookings.get(rec.partnerUuid).contact.fullName, 'Sam Lee');
});

test('intake rejects requests without the right credentials', async () => {
  const res = await fetch(`${connectorUrl}/intake/booking`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 401);
  const bad = await fetch(`${connectorUrl}/bookings`, { headers: { Authorization: 'Basic ' + Buffer.from('hook:wrong').toString('base64') } });
  assert.equal(bad.status, 401);
});

test('availability watcher reports departures that close', async () => {
  const client = new OctoClient({ baseUrl: partnerUrl, apiKey: 'partner-key' });
  const today = new Date(`${DATE}T00:00:00Z`);
  const first = await checkAvailability({ client, mappings, days: 1, today });
  await fetch(`${partnerUrl}/_simulate/close-slot`, { method: 'POST', body: JSON.stringify({ availabilityId: '2026-12-06T09:00:00-05:00' }) });
  const second = await checkAvailability({ client, mappings, days: 1, today, previous: first.current });
  assert.deepEqual(second.changes.map((c) => [c.start, c.now]), [['2026-12-06T09:00:00-05:00', 'CLOSED']]);
});
