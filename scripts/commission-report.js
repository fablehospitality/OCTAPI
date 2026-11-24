// Prints the commission report for a month and saves a CSV next to the data.
//   npm run commission-report                (last month)
//   npm run commission-report -- 2026-12
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { BookingStore } from '../src/store.js';
import { commissionReport, reportToCsv, reportToText } from '../src/commission.js';

const config = loadConfig();
const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
const month = process.argv[2] || d.toISOString().slice(0, 7);
if (!/^\d{4}-\d{2}$/.test(month)) { console.error('Month must look like 2026-12'); process.exit(1); }

const report = commissionReport(new BookingStore(config.dataFile).all(), month);
const csvPath = resolve(dirname(config.dataFile), `commission-${month}.csv`);
writeFileSync(csvPath, reportToCsv(report));
console.log(reportToText(report));
console.log(`\nCSV saved to ${csvPath}`);
