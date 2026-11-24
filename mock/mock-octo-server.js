// A small in-memory OCTO supplier that behaves like a Peek account, for
// testing the connector before real API keys arrive.
//
//   node mock/mock-octo-server.js [port] [apiKey]
//
// Extra test-only route: POST /_simulate/direct-booking fires the account's
// registered webhooks as if a guest had booked on the Peek booking page.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function createMockOcto({ apiKey = 'test-key', products, capacity = 10, times = ['09:00', '14:00'], fetchImpl = fetch } = {}) {
  const state = {
    products: products || [{
      id: 'kayak-tour', internalName: 'Sunset Kayak Tour', reference: 'KAYAK',
      options: [{ id: 'DEFAULT', default: true, internalName: 'Standard', units: [
        { id: 'unit-adult', internalName: 'Adult', type: 'ADULT', price: 6500 },
        { id: 'unit-child', internalName: 'Child', type: 'CHILD', price: 2500 },
      ] }],
    }],
    capacity: {},       // availabilityId -> remaining seats (lazy)
    closed: new Set(),  // availabilityIds forced closed
    bookings: new Map(),
    webhooks: [],
    seq: 1000,
  };

  const slotId = (date, time) => `${date}T${time}:00-05:00`;
  const remaining = (id) => (state.capacity[id] ??= capacity);
  const slot = (productId, optionId, id, wanted = 1) => {
    const left = remaining(id);
    const status = state.closed.has(id) ? 'CLOSED' : left < Math.max(wanted, 1) ? 'SOLD_OUT' : left <= 3 ? 'LIMITED' : 'AVAILABLE';
    const units = state.products.find((p) => p.id === productId)?.options.find((o) => o.id === optionId)?.units || [];
    const unitPricing = units.map((u) => ({ unitId: u.id, retail: u.price ?? 5000, net: u.price ?? 5000, original: u.price ?? 5000, currency: 'USD', currencyPrecision: 2, includedTaxes: [] }));
    return { id, localDateTimeStart: id, localDateTimeEnd: id, allDay: false, available: status === 'AVAILABLE' || status === 'LIMITED', status, vacancies: Math.max(left, 0), capacity, unitPricing };
  };
  const dates = (from, to) => {
    const out = []; const d = new Date(from + 'T00:00:00Z'); const end = new Date(to + 'T00:00:00Z');
    while (d <= end && out.length < 400) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
    return out;
  };

  async function fire(booking) {
    for (const w of state.webhooks) {
      const u = new URL(w.url);
      const headers = { 'Content-Type': 'application/json' };
      if (u.username) headers.Authorization = 'Basic ' + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64');
      u.username = ''; u.password = '';
      try {
        const r = await fetchImpl(u.toString(), { method: 'POST', headers, body: JSON.stringify({ webhook: w, booking }) });
        await r.text();
      } catch (e) { console.error('mock webhook delivery failed:', e.message); }
    }
  }

  function makeBooking(body, status) {
    const product = state.products.find((p) => p.id === body.productId);
    if (!product) return [400, { error: 'INVALID_PRODUCT_ID', errorMessage: 'Unknown product' }];
    const items = body.unitItems || [];
    if (remaining(body.availabilityId) < items.length || state.closed.has(body.availabilityId)) {
      return [400, { error: 'UNPROCESSABLE_ENTITY', errorMessage: 'Not enough availability' }];
    }
    state.capacity[body.availabilityId] -= items.length;
    const b = {
      uuid: body.uuid || randomUUID(), status, supplierReference: `PK-${state.seq++}`,
      resellerReference: body.resellerReference || null, productId: body.productId, optionId: body.optionId || 'DEFAULT',
      availabilityId: body.availabilityId, availability: { id: body.availabilityId, localDateTimeStart: body.availabilityId },
      unitItems: items.map((i) => ({ uuid: randomUUID(), unitId: i.unitId, contact: i.contact || {} })),
      contact: body.contact || {}, notes: body.notes || '',
    };
    state.bookings.set(b.uuid, b);
    return [200, b];
  }

  const server = http.createServer(async (req, res) => {
    const send = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    let body = '';
    for await (const c of req) body += c;
    body = body ? JSON.parse(body) : {};
    const path = new URL(req.url, 'http://x').pathname;

    if (path === '/_simulate/direct-booking' && req.method === 'POST') {
      const [s, b] = makeBooking(body, 'CONFIRMED');
      if (s === 200) await fire(b);
      return send(s, b);
    }
    if (path === '/_simulate/direct-cancel' && req.method === 'POST') {
      const b = state.bookings.get(body.uuid);
      if (!b) return send(404, { error: 'not found' });
      b.status = 'CANCELLED'; await fire(b);
      return send(200, b);
    }
    if (path === '/_simulate/close-slot' && req.method === 'POST') { state.closed.add(body.availabilityId); return send(200, { ok: true }); }

    if (req.headers.authorization !== `Bearer ${apiKey}`) return send(403, { error: 'UNAUTHORIZED', errorMessage: 'Bad API key' });

    let m;
    if (req.method === 'GET' && path === '/supplier') return send(200, { id: 'mock-supplier', name: 'Mock Peek Supplier' });
    if (req.method === 'GET' && path === '/products') return send(200, state.products);
    if (req.method === 'GET' && (m = path.match(/^\/products\/([^/]+)$/))) {
      const p = state.products.find((x) => x.id === decodeURIComponent(m[1]));
      return p ? send(200, p) : send(400, { error: 'INVALID_PRODUCT_ID' });
    }
    if (req.method === 'POST' && path === '/availability') {
      const { productId, optionId = 'DEFAULT', localDateStart, localDateEnd, units = [] } = body;
      const wanted = units.reduce((n, u) => n + Number(u.quantity || 0), 0);
      if (!state.products.some((p) => p.id === productId)) return send(400, { error: 'INVALID_PRODUCT_ID' });
      return send(200, dates(localDateStart, localDateEnd || localDateStart).flatMap((d) => times.map((t) => slot(productId, optionId, slotId(d, t), wanted))));
    }
    if (req.method === 'POST' && path === '/bookings') { const [s, b] = makeBooking(body, 'ON_HOLD'); return send(s, b); }
    if ((m = path.match(/^\/bookings\/([^/]+)(\/confirm|\/cancel)?$/))) {
      const b = state.bookings.get(decodeURIComponent(m[1]));
      if (!b) return send(400, { error: 'INVALID_BOOKING_UUID' });
      if (req.method === 'GET' && !m[2]) return send(200, b);
      if (req.method === 'POST' && m[2] === '/confirm') {
        b.status = 'CONFIRMED'; b.contact = body.contact || b.contact;
        if (body.resellerReference) b.resellerReference = body.resellerReference;
        return send(200, b);
      }
      if (req.method === 'POST' && m[2] === '/cancel') {
        if (b.status !== 'CANCELLED') state.capacity[b.availabilityId] += b.unitItems.length;
        b.status = 'CANCELLED'; return send(200, b);
      }
    }
    if (path === '/webhooks' && req.method === 'POST') { const w = { id: randomUUID(), ...body }; state.webhooks.push(w); return send(200, w); }
    if (path === '/webhooks' && req.method === 'GET') return send(200, state.webhooks);
    return send(404, { error: 'NOT_FOUND' });
  });

  return { server, state };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] || 4001);
  const key = process.argv[3] || 'test-key';
  createMockOcto({ apiKey: key }).server.listen(port, () => console.info(`Mock OCTO supplier on http://localhost:${port} (API key: ${key})`));
}
