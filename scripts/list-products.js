// Prints product, option and unit IDs so you can fill in mappings.json.
//   npm run list-products -- partner     (default)
//   npm run list-products -- mine
import { loadConfig } from '../src/config.js';
import { OctoClient } from '../src/octo-client.js';

const which = process.argv[2] === 'mine' ? 'mine' : 'partner';
const config = loadConfig();
if (!config[which].apiKey) {
  console.error(`No API key for "${which}". Set ${which === 'mine' ? 'MY_OCTO_API_KEY' : 'PARTNER_OCTO_API_KEY'} in .env`);
  process.exit(1);
}
const products = await new OctoClient(config[which]).getProducts();
for (const p of products) {
  console.log(`\n${p.internalName || p.title || p.id}\n  productId: ${p.id}`);
  for (const o of p.options || []) {
    console.log(`  optionId:  ${o.id}${o.internalName ? `  (${o.internalName})` : ''}`);
    for (const u of o.units || []) console.log(`    unitId:  ${u.id}  (${u.internalName || u.type})`);
  }
}
