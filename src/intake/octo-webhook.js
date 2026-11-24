// Converts an OCTO booking webhook (sent by YOUR Peek account) into the
// connector's normalized booking. Accepts { booking: {...} } or a bare booking.
export function parseOctoWebhook(body) {
  const booking = body?.booking ?? body;
  if (!booking || typeof booking !== 'object' || !booking.productId) {
    throw new Error('Webhook body has no OCTO booking');
  }

  const counts = {};
  for (const item of booking.unitItems || []) {
    const id = item.unitId || item.unit?.id;
    if (id) counts[id] = (counts[id] || 0) + 1;
  }

  const firstItemContact = (booking.unitItems || []).map((i) => i.contact).find((c) => c && (c.fullName || c.emailAddress));
  const status = String(booking.status || '').toUpperCase();

  return {
    action: status === 'CANCELLED' ? 'cancel' : status === 'CONFIRMED' ? 'book' : 'ignore',
    status,
    sourceBookingId: booking.uuid || booking.supplierReference,
    sourceReference: booking.supplierReference || null,
    productId: booking.productId,
    optionId: booking.optionId,
    start: booking.availability?.localDateTimeStart || booking.availabilityId,
    units: Object.entries(counts).map(([unitId, quantity]) => ({ unitId, quantity })),
    contact: booking.contact && (booking.contact.fullName || booking.contact.emailAddress) ? booking.contact : firstItemContact || {},
    notes: booking.notes || '',
    // What the guest paid on your Peek page, when Peek includes pricing.
    amountPaid: booking.pricing?.retail ?? null,
    currency: booking.pricing?.currency ?? null,
  };
}
