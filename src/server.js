// HTTP server: receives booking notifications and hands them to the forwarder.
//
//   GET  /health                 -> liveness check
//   POST /intake/octo-webhook    -> OCTO booking webhook from YOUR Peek account
//   POST /intake/booking         -> normalized booking (Zapier, Make, manual, email parser...)
//   POST /intake/cancel          -> { sourceBookingId, reason? }
//   GET  /bookings               -> log of forwarded bookings (JSON)
//
// Every route except /health requires HTTP basic auth (INTAKE_USER / INTAKE_PASS).
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { OctoClient } from './octo-client.js';
import { BookingStore } from './store.js';
import { Forwarder } from './forwarder.js';
import { createNotifier } from './notify.js';
import { parseOctoWebhook } from './intake/octo-webhook.js';

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function authorized(req, { user, pass }) {
  if (!user || !pass) return false; // refuse everything until credentials are configured
  const m = (req.headers.authorization || '').match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const [u, ...rest] = Buffer.from(m[1], 'base64').toString().split(':');
  return safeEqual(u, user) && safeEqual(rest.join(':'), pass);
}

async function readJson(req, limit = 1_000_000) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Body too large'), { statusCode: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString();
  try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createApp({ config, forwarder, store, log = console }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (!authorized(req, config.intake)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="connector"');
        return send(res, 401, { error: 'Unauthorized' });
      }

      if (req.method === 'GET' && url.pathname === '/bookings') return send(res, 200, store.all());

      if (req.method === 'POST' && url.pathname === '/intake/octo-webhook') {
        const parsed = parseOctoWebhook(await readJson(req));
        log.info(`Webhook: ${parsed.status} ${parsed.sourceBookingId} product=${parsed.productId}`);
        if (parsed.action === 'book') return send(res, 200, await forwarder.forwardBooking(parsed));
        if (parsed.action === 'cancel') return send(res, 200, await forwarder.cancelBooking(parsed.sourceBookingId, 'Cancelled by reseller'));
        return send(res, 200, { ignored: true, status: parsed.status });
      }

      if (req.method === 'POST' && url.pathname === '/intake/booking') {
        const body = await readJson(req);
        if (!body.sourceBookingId || !body.productId || !body.start) {
          return send(res, 400, { error: 'sourceBookingId, productId and start are required' });
        }
        return send(res, 200, await forwarder.forwardBooking(body));
      }

      if (req.method === 'POST' && url.pathname === '/intake/cancel') {
        const body = await readJson(req);
        if (!body.sourceBookingId) return send(res, 400, { error: 'sourceBookingId is required' });
        return send(res, 200, await forwarder.cancelBooking(body.sourceBookingId, body.reason));
      }

      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      log.error(err.message);
      // 5xx tells the sender (Peek, Zapier) to retry later; the forwarder is safe to retry.
      return send(res, err.statusCode || 502, { error: err.message });
    }
  });
}

export function buildFromConfig(config = loadConfig(), deps = {}) {
  const store = deps.store || new BookingStore(config.dataFile);
  const forwarder = new Forwarder({
    partnerClient: deps.partnerClient || new OctoClient(config.partner),
    store,
    mappings: config.mappings,
    notify: deps.notify || createNotifier({ alertWebhookUrl: config.alertWebhookUrl }),
    log: deps.log || console,
  });
  return { app: createApp({ config, forwarder, store, log: deps.log || console }), forwarder, store };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  if (!config.partner.apiKey) console.warn('PARTNER_OCTO_API_KEY is not set: bookings cannot be forwarded yet.');
  if (!config.intake.user || !config.intake.pass) console.warn('INTAKE_USER / INTAKE_PASS are not set: all intake requests will be refused.');
  console.info(`Loaded ${config.mappings.products?.length || 0} product mapping(s).`);
  const { app } = buildFromConfig(config);
  app.listen(config.port, () => console.info(`Connector listening on :${config.port}`));
}
