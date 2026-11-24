// The core of the connector: takes a booking made in YOUR Peek account for a
// mirrored partner tour and places the same booking in the PARTNER's Peek
// account over OCTO (reserve, then confirm). Also forwards cancellations.
//
// Incoming bookings use this normalized shape (see src/intake/*):
// {
//   sourceBookingId: "your Peek booking ID",
//   productId: "your mirrored product ID",
//   optionId: "optional",
//   start: "2026-12-05T09:00"          // local start time of the tour
//   units: [{ unitId: "adult-id-or-name", quantity: 2 }],
//   contact: { fullName, firstName, lastName, emailAddress, phoneNumber, country },
//   notes: "optional"
// }
import { randomUUID } from 'node:crypto';

const BOOKABLE = new Set(['AVAILABLE', 'FREESALE', 'LIMITED']);

export function findMapping(mappings, productId, optionId) {
  const list = mappings?.products || [];
  return list.find((m) => m.mine.productId === productId && (!m.mine.optionId || !optionId || m.mine.optionId === optionId))
    || null;
}

// Turns your unit list into the partner's OCTO unitItems (one item per person).
export function mapUnits(mapping, units) {
  const table = mapping.units || {};
  const lower = Object.fromEntries(Object.entries(table).map(([k, v]) => [k.toLowerCase(), v]));
  const unitItems = [];
  const unitCounts = {};
  for (const u of units || []) {
    const key = String(u.unitId ?? u.name ?? '');
    const partnerUnitId = table[key] ?? lower[key.toLowerCase()] ?? mapping.defaultPartnerUnitId;
    if (!partnerUnitId) throw new Error(`No partner unit mapped for "${key}" on ${mapping.name || mapping.mine.productId}`);
    const qty = Number(u.quantity ?? 1);
    for (let i = 0; i < qty; i++) unitItems.push({ unitId: partnerUnitId });
    unitCounts[partnerUnitId] = (unitCounts[partnerUnitId] || 0) + qty;
  }
  if (!unitItems.length) throw new Error('Booking has no guests/units');
  return { unitItems, units: Object.entries(unitCounts).map(([id, quantity]) => ({ id, quantity })) };
}

const minute = (s) => String(s || '').slice(0, 16); // "YYYY-MM-DDTHH:MM"

function partnerContact(c = {}) {
  const fullName = c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ');
  return {
    fullName: fullName || undefined,
    firstName: c.firstName || undefined,
    lastName: c.lastName || undefined,
    emailAddress: c.emailAddress || undefined,
    phoneNumber: c.phoneNumber || undefined,
    country: c.country || undefined,
    locales: c.locales || ['en'],
  };
}

export class Forwarder {
  constructor({ partnerClient, store, mappings, notify = async () => {}, log = console, resellerPrefix = '' }) {
    this.partner = partnerClient;
    this.store = store;
    this.mappings = mappings;
    this.notify = notify;
    this.log = log;
    this.resellerPrefix = resellerPrefix;
    this.locks = new Map();
  }

  // Serialize work per booking so duplicate webhook deliveries can't double-book.
  async withLock(id, fn) {
    const prev = this.locks.get(id) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    this.locks.set(id, run);
    try { return await run; } finally { if (this.locks.get(id) === run) this.locks.delete(id); }
  }

  forwardBooking(booking) {
    if (!booking?.sourceBookingId) throw new Error('sourceBookingId is required');
    return this.withLock(booking.sourceBookingId, () => this.#forward(booking));
  }

  cancelBooking(sourceBookingId, reason = 'Cancelled by reseller') {
    return this.withLock(sourceBookingId, () => this.#cancel(sourceBookingId, reason));
  }

  async #forward(b) {
    const existing = this.store.get(b.sourceBookingId);
    if (existing?.status === 'CONFIRMED') {
      if (minute(existing.start) !== minute(b.start) || JSON.stringify(existing.units) !== JSON.stringify(b.units)) {
        await this.notify('Booking changed after it was sent to the partner. Update it in their Peek by hand.', {
          yourBooking: b.sourceBookingId, partnerReference: existing.partnerReference,
          was: { start: existing.start, units: existing.units }, now: { start: b.start, units: b.units },
        });
        return { ...existing, changed: true };
      }
      return { ...existing, duplicate: true };
    }
    if (existing?.status === 'CANCELLED') return { ...existing, duplicate: true };

    const mapping = findMapping(this.mappings, b.productId, b.optionId);
    if (!mapping) {
      // Not a partner tour: one of your own products. Nothing to do.
      return this.store.upsert(b.sourceBookingId, { status: 'IGNORED', productId: b.productId, start: b.start });
    }

    const base = {
      productName: mapping.name, productId: b.productId, start: b.start, units: b.units,
      contactName: partnerContact(b.contact).fullName,
    };

    try {
      const { unitItems, units } = mapUnits(mapping, b.units);
      this.store.upsert(b.sourceBookingId, { ...base, status: 'FORWARDING' });

      // A previous attempt may have reserved but failed to confirm: reuse that hold if it's still alive.
      let reserved = null;
      if (existing?.partnerUuid) {
        try {
          const prior = await this.partner.getBooking(existing.partnerUuid);
          if (prior?.status === 'CONFIRMED') {
            return this.store.upsert(b.sourceBookingId, { ...base, status: 'CONFIRMED', partnerReference: prior.supplierReference, error: null });
          }
          if (prior?.status === 'ON_HOLD') reserved = prior;
        } catch { /* hold is gone; reserve again */ }
      }

      if (!reserved) {
        const date = minute(b.start).slice(0, 10);
        const slots = await this.partner.getAvailability({
          productId: mapping.partner.productId,
          optionId: mapping.partner.optionId || 'DEFAULT',
          localDateStart: date,
          localDateEnd: date,
          units,
        });
        const slot = (slots || []).find((s) => minute(s.localDateTimeStart) === minute(b.start));
        if (!slot || slot.available === false || !BOOKABLE.has(slot.status)) {
          const why = !slot ? 'partner has no departure at that time' : `partner slot is ${slot.status}`;
          await this.notify('Could not place partner booking: no availability. Contact the guest and refund or rebook.', {
            yourBooking: b.sourceBookingId, tour: mapping.name, start: b.start, guests: unitItems.length, reason: why,
          });
          return this.store.upsert(b.sourceBookingId, { ...base, status: 'FAILED', error: `No availability: ${why}` });
        }

        const partnerUuid = randomUUID();
        this.store.upsert(b.sourceBookingId, { partnerUuid });
        reserved = await this.partner.reserve({
          uuid: partnerUuid,
          productId: mapping.partner.productId,
          optionId: mapping.partner.optionId || 'DEFAULT',
          availabilityId: slot.id,
          unitItems,
          notes: b.notes || undefined,
          resellerReference: this.resellerPrefix + b.sourceBookingId,
        });
        if (reserved?.uuid && reserved.uuid !== partnerUuid) this.store.upsert(b.sourceBookingId, { partnerUuid: reserved.uuid });
      }

      const confirmed = await this.partner.confirm(reserved.uuid, {
        contact: partnerContact(b.contact),
        resellerReference: this.resellerPrefix + b.sourceBookingId,
        emailReceipt: false,
      });
      this.log.info(`Forwarded ${b.sourceBookingId} -> partner ${confirmed.supplierReference || confirmed.uuid}`);
      return this.store.upsert(b.sourceBookingId, {
        ...base, status: 'CONFIRMED', partnerUuid: confirmed.uuid || reserved.uuid,
        partnerReference: confirmed.supplierReference || null, error: null,
      });
    } catch (err) {
      await this.notify('Failed to send booking to partner. It will retry if the notification is re-sent; otherwise book it by hand.', {
        yourBooking: b.sourceBookingId, tour: mapping.name, start: b.start, error: err.message,
      });
      this.store.upsert(b.sourceBookingId, { ...base, status: 'FAILED', error: err.message });
      throw err;
    }
  }

  async #cancel(sourceBookingId, reason) {
    const rec = this.store.get(sourceBookingId);
    if (!rec || rec.status === 'IGNORED') return { sourceBookingId, status: 'IGNORED' };
    if (rec.status === 'CANCELLED') return { ...rec, duplicate: true };
    if (!rec.partnerUuid) return this.store.upsert(sourceBookingId, { status: 'CANCELLED' });
    try {
      await this.partner.cancel(rec.partnerUuid, reason);
      return this.store.upsert(sourceBookingId, { status: 'CANCELLED', error: null });
    } catch (err) {
      await this.notify('Failed to cancel partner booking. Cancel it in their Peek by hand.', {
        yourBooking: sourceBookingId, partnerReference: rec.partnerReference, error: err.message,
      });
      this.store.upsert(sourceBookingId, { status: 'CANCEL_FAILED', error: err.message });
      throw err;
    }
  }
}
