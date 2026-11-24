// Asks YOUR Peek account (via OCTO) to send booking updates to this connector.
// Needs MY_OCTO_API_KEY, PUBLIC_URL, INTAKE_USER and INTAKE_PASS in .env.
import { loadConfig } from '../src/config.js';
import { OctoClient } from '../src/octo-client.js';

const config = loadConfig();
const missing = ['MY_OCTO_API_KEY', 'PUBLIC_URL', 'INTAKE_USER', 'INTAKE_PASS'].filter((k) => !process.env[k]);
if (missing.length) { console.error('Missing in .env: ' + missing.join(', ')); process.exit(1); }

const url = new URL('/intake/octo-webhook', config.publicUrl);
url.username = encodeURIComponent(config.intake.user);
url.password = encodeURIComponent(config.intake.pass);

const client = new OctoClient(config.mine);
const hook = await client.createWebhook({ url: url.toString(), event: 'booking_update' });
console.log('Webhook registered:', hook.id || JSON.stringify(hook));
