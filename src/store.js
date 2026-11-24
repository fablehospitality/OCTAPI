// Tiny JSON-file store of forwarded bookings, keyed by your Peek booking ID.
// Good enough for a few hundred bookings a day; swap for a database later.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export class BookingStore {
  constructor(file) {
    this.file = file;
    this.records = {};
    if (file && existsSync(file)) this.records = JSON.parse(readFileSync(file, 'utf8'));
  }

  get(sourceBookingId) { return this.records[sourceBookingId]; }

  all() {
    return Object.values(this.records).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  upsert(sourceBookingId, patch) {
    const now = new Date().toISOString();
    const prev = this.records[sourceBookingId] || { sourceBookingId, createdAt: now, history: [] };
    const next = { ...prev, ...patch, updatedAt: now };
    if (patch.status && patch.status !== prev.status) {
      next.history = [...(prev.history || []), { at: now, status: patch.status, note: patch.error || undefined }];
    }
    this.records[sourceBookingId] = next;
    this.save();
    return next;
  }

  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.records, null, 2));
    renameSync(tmp, this.file);
  }
}
