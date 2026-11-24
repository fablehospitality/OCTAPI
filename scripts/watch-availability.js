// Checks the partner's availability for every mapped tour and alerts when a
// departure fills up or closes, so you can close the same slot in your Peek
// before someone books a seat that doesn't exist. Run it on a schedule
// (e.g. every 15 minutes with cron or your host's scheduler).
//   npm run watch-availability -- [daysAhead=30]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { OctoClient } from '../src/octo-client.js';
import { createNotifier } from '../src/notify.js';

export async function checkAvailability({ client, mappings, previous = {}, days = 30, today = new Date() }) {
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
  const current = {}; const changes = [];
  for (const m of mappings.products || []) {
    const slots = await client.getAvailability({ productId: m.partner.productId, optionId: m.partner.optionId || 'DEFAULT', localDateStart: start, localDateEnd: end });
    for (const s of slots) {
      const key = `${m.partner.productId}|${s.localDateTimeStart}`;
      const open = s.available !== false && ['AVAILABLE', 'FREESALE', 'LIMITED'].includes(s.status);
      current[key] = { open, vacancies: s.vacancies ?? null };
      const was = previous[key];
      if (was && was.open !== open) changes.push({ tour: m.name, start: s.localDateTimeStart, now: open ? 'OPEN' : s.status, vacancies: s.vacancies });
    }
  }
  return { current, changes };
}

if (process.argv[1]?.endsWith('watch-availability.js')) {
  const config = loadConfig();
  const stateFile = resolve(dirname(config.dataFile), 'availability-state.json');
  const previous = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  const { current, changes } = await checkAvailability({
    client: new OctoClient(config.partner), mappings: config.mappings, previous, days: Number(process.argv[2] || 30),
  });
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(current, null, 2));
  const notify = createNotifier({ alertWebhookUrl: config.alertWebhookUrl });
  for (const c of changes) {
    await notify(c.now === 'OPEN' ? 'Partner departure reopened: you can reopen it in your Peek' : 'Partner departure is full/closed: close it in your Peek', c);
  }
  console.log(`Checked ${Object.keys(current).length} departures, ${changes.length} change(s).`);
}
