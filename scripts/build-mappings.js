// Builds mappings.json for the Cornerstone Tours mirror products, so you
// don't have to copy IDs by hand.
//
//   npm run build-mappings            (preview only, writes nothing)
//   npm run build-mappings -- --write (saves mappings.json, backing up the old one)
//
// It reads both product lists over OCTO (needs MY_OCTO_API_KEY and
// PARTNER_OCTO_API_KEY in .env), then:
//   - finds each of YOUR mirror products by its exact name (see TOURS below),
//   - links it to Cornerstone's product by Cornerstone's ID,
//   - matches guest types by name ("Adult" -> "Adult", "Child (0-3)" -> "Child").
// Mappings for other products already in mappings.json are kept.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Your mirror product name in Peek -> Cornerstone's OCTO product ID.
export const TOURS = [
  { name: 'Arlington Cemetery', partnerProductId: 'av_7j78j' },
  { name: 'Capitol Hill', partnerProductId: 'av_e38j7' },
  { name: 'Capitol + Supreme Court', partnerProductId: 'av_d8jrb' },
  { name: 'Lincoln Assassination', partnerProductId: 'av_vvgw4' },
  { name: 'Georgetown Walking Tour', partnerProductId: 'av_y9znw' },
  { name: 'Cherry Blossom Walking Tour', partnerProductId: 'av_d85g8' },
  { name: 'SCOTUS + Capitol', partnerProductId: 'av_55bjq' },
  { name: 'Big 3 Capitol Hill', partnerProductId: 'av_zmj58' },
  { name: 'National Archives', partnerProductId: 'av_55bwn' },
];

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const productName = (p) => p.internalName || p.title || p.reference || '';
// "Adult (13-64)" -> "adult"
export const unitName = (u) => norm(String(u.internalName || u.title || u.reference || u.type || '').replace(/\(.*?\)/g, ''));

function defaultOption(product) {
  const opts = product.options || [];
  return opts.find((o) => o.default) || opts[0] || null;
}

// Returns { products: [...], report: [lines], problems: n }
export function buildMappings({ mine, partner, existing = { products: [] }, tours = TOURS }) {
  const report = [];
  let problems = 0;
  const built = [];

  for (const tour of tours) {
    const myMatches = mine.filter((p) => norm(productName(p)) === norm(tour.name));
    const theirs = partner.find((p) => p.id === tour.partnerProductId);
    if (myMatches.length !== 1) {
      problems++;
      report.push(`✗ ${tour.name}: ${myMatches.length ? `${myMatches.length} products in your Peek have this name; rename the extras` : 'no product with this exact name in your Peek'}`);
      continue;
    }
    if (!theirs) {
      problems++;
      report.push(`✗ ${tour.name}: Cornerstone product ${tour.partnerProductId} not visible with your partner key`);
      continue;
    }
    const myProduct = myMatches[0];
    const myOption = defaultOption(myProduct);
    const theirOption = defaultOption(theirs);
    const theirUnits = new Map((theirOption?.units || []).map((u) => [unitName(u), u]));

    const units = {};
    const missing = [];
    for (const u of myOption?.units || []) {
      const match = theirUnits.get(unitName(u));
      if (!match) { missing.push(unitName(u) || u.id); continue; }
      units[u.id] = match.id;              // what Peek's booking notifications send
      const label = String(u.internalName || u.title || '').trim();
      if (label) units[label] = match.id;  // for manual / Zapier intake by name
    }
    if (missing.length) {
      problems++;
      report.push(`✗ ${tour.name}: no Cornerstone guest type named ${missing.map((m) => `"${m}"`).join(', ')} (theirs: ${[...theirUnits.keys()].join(', ') || 'none'})`);
    } else {
      report.push(`✓ ${tour.name}: ${myProduct.id} -> ${theirs.id} (${Object.keys(units).filter((k) => !(myOption.units || []).some((u) => u.id === k)).join(', ')})`);
    }
    built.push({
      name: `${tour.name} (Cornerstone)`,
      mine: { productId: myProduct.id },
      partner: { productId: theirs.id, optionId: theirOption?.id || 'DEFAULT' },
      units,
    });
  }

  const ours = new Set(built.map((m) => m.mine.productId));
  const kept = (existing.products || []).filter((m) => !ours.has(m.mine?.productId));
  return { products: [...kept, ...built], report, problems, kept: kept.length };
}

async function main() {
  const { loadConfig } = await import('../src/config.js');
  const { OctoClient } = await import('../src/octo-client.js');
  const config = loadConfig();
  const missingKeys = [['MY_OCTO_API_KEY', config.mine.apiKey], ['PARTNER_OCTO_API_KEY', config.partner.apiKey]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (missingKeys.length) { console.error('Missing in .env: ' + missingKeys.join(', ')); process.exit(1); }

  const [mine, partner] = await Promise.all([
    new OctoClient(config.mine).getProducts(),
    new OctoClient(config.partner).getProducts(),
  ]);
  const path = resolve(process.env.MAPPINGS_FILE || 'mappings.json');
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { products: [] };
  const result = buildMappings({ mine, partner, existing });

  console.log(result.report.join('\n'));
  if (result.kept) console.log(`\nKeeping ${result.kept} other mapping(s) already in ${path}.`);

  if (!process.argv.includes('--write')) {
    console.log('\nPreview only. Run again with --write to save mappings.json.');
    return;
  }
  if (existsSync(path)) copyFileSync(path, path.replace(/\.json$/, '') + '.backup.json');
  writeFileSync(path, JSON.stringify({ ...existing, products: result.products }, null, 2) + '\n');
  console.log(`\nSaved ${path}. Restart the connector to load it.`);
  if (result.problems) console.log(`${result.problems} tour(s) need attention (marked ✗ above).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
