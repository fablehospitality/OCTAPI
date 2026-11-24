// Loads settings from environment variables (and an optional .env file)
// plus the product mapping file.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(path = '.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export function loadConfig(overrides = {}) {
  loadDotEnv();
  const env = { ...process.env, ...overrides };
  const mappingPath = resolve(env.MAPPINGS_FILE || 'mappings.json');
  const mappings = overrides.mappings
    ?? (existsSync(mappingPath) ? JSON.parse(readFileSync(mappingPath, 'utf8')) : { products: [] });

  return {
    port: Number(env.PORT || 3000),
    // The partner's Peek OCTO API: where bookings get created.
    partner: {
      baseUrl: env.PARTNER_OCTO_BASE_URL || 'https://octo.peek.com/integrations/octo',
      apiKey: env.PARTNER_OCTO_API_KEY || '',
    },
    // Your own Peek OCTO API: optional, used to register the booking webhook.
    mine: {
      baseUrl: env.MY_OCTO_BASE_URL || 'https://octo.peek.com/integrations/octo',
      apiKey: env.MY_OCTO_API_KEY || '',
    },
    // Credentials incoming booking notifications must present (HTTP basic auth).
    intake: {
      user: env.INTAKE_USER || '',
      pass: env.INTAKE_PASS || '',
    },
    publicUrl: env.PUBLIC_URL || '',
    alertWebhookUrl: env.ALERT_WEBHOOK_URL || '',
    // Share of each booking you keep. Override per tour with "commissionRate" in mappings.json.
    commissionRate: Number(env.COMMISSION_RATE || 0.25),
    dataFile: resolve(env.DATA_FILE || 'data/bookings.json'),
    mappings,
  };
}
