// Monthly commission report: for every partner booking that went through,
// how much you keep and how much you owe the partner.
//
// Basis: the partner's own retail price for the guests booked (captured from
// their availability at booking time). If that wasn't available, falls back to
// what the guest paid on your Peek page. Amounts are in cents.
// Bookings are counted in the month the tour takes place.
// Cancelled and failed bookings are listed but not counted.

const money = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));

export function commissionReport(records, month) {
  const rows = [];
  const byTour = {};
  const totals = { bookings: 0, guests: 0, basis: 0, commission: 0, owed: 0, amountPaid: 0 };
  const excluded = [];

  for (const r of records) {
    if (r.status === 'IGNORED' || !String(r.start || '').startsWith(month)) continue;
    if (r.status !== 'CONFIRMED') { excluded.push({ sourceBookingId: r.sourceBookingId, tour: r.productName, start: r.start, status: r.status }); continue; }

    const guests = (r.units || []).reduce((n, u) => n + Number(u.quantity || 1), 0);
    const basis = r.partnerRetail ?? r.amountPaid ?? null;
    const rate = r.commissionRate ?? 0.25;
    const commission = basis == null ? null : Math.round(basis * rate);
    const owed = basis == null ? null : basis - commission;

    rows.push({
      tourDate: String(r.start).slice(0, 16).replace('T', ' '),
      tour: r.productName,
      yourBooking: r.sourceBookingId,
      partnerReference: r.partnerReference,
      guest: r.contactName || '',
      guests,
      currency: r.currency || 'USD',
      basis, ratePct: Math.round(rate * 1000) / 10, commission, owed,
      amountPaid: r.amountPaid ?? null,
      note: basis == null ? 'No price captured: check by hand' : '',
    });

    const t = (byTour[r.productName] ??= { tour: r.productName, bookings: 0, guests: 0, basis: 0, commission: 0, owed: 0 });
    t.bookings++; t.guests += guests; t.basis += basis || 0; t.commission += commission || 0; t.owed += owed || 0;
    totals.bookings++; totals.guests += guests; totals.basis += basis || 0; totals.commission += commission || 0;
    totals.owed += owed || 0; totals.amountPaid += r.amountPaid || 0;
  }

  rows.sort((a, b) => a.tourDate.localeCompare(b.tourDate));
  return { month, rows, byTour: Object.values(byTour), totals, excluded, missingPrices: rows.filter((r) => r.basis == null).length };
}

export function reportToCsv(report) {
  const cols = ['tourDate', 'tour', 'yourBooking', 'partnerReference', 'guest', 'guests', 'currency', 'basis', 'ratePct', 'commission', 'owed', 'amountPaid', 'note'];
  const head = ['Tour date', 'Tour', 'Your booking', 'Partner ref', 'Guest', 'Guests', 'Currency', 'Partner price', 'Your %', 'You keep', 'Owed to partner', 'Guest paid you', 'Note'];
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const fmt = (c, v) => (['basis', 'commission', 'owed', 'amountPaid'].includes(c) ? money(v) : v);
  const lines = [head.join(',')];
  for (const r of report.rows) lines.push(cols.map((c) => esc(fmt(c, r[c]))).join(','));
  const t = report.totals;
  lines.push(['TOTAL', '', '', '', '', t.guests, '', money(t.basis), '', money(t.commission), money(t.owed), money(t.amountPaid), ''].map(esc).join(','));
  return lines.join('\n') + '\n';
}

export function reportToText(report) {
  const t = report.totals;
  const out = [`Commission report for ${report.month}`, ''];
  if (!report.rows.length) out.push('No confirmed partner bookings this month.');
  for (const s of report.byTour) {
    out.push(`${s.tour}: ${s.bookings} booking(s), ${s.guests} guest(s), partner price $${money(s.basis)}, you keep $${money(s.commission)}, owed $${money(s.owed)}`);
  }
  out.push('', `TOTAL: ${t.bookings} booking(s), ${t.guests} guest(s)`, `  Partner price: $${money(t.basis)}`, `  You keep:      $${money(t.commission)}`, `  Owed partner:  $${money(t.owed)}`);
  if (report.missingPrices) out.push('', `⚠ ${report.missingPrices} booking(s) had no price captured: check those by hand.`);
  if (report.excluded.length) out.push('', `Not counted (cancelled/failed): ${report.excluded.length}`);
  return out.join('\n');
}
