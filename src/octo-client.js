// Minimal OCTO API client covering the calls the connector needs.
// Spec: https://docs.octo.travel

export class OctoError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class OctoClient {
  constructor({ baseUrl, apiKey, capabilities = 'octo/pricing', fetchImpl = fetch }) {
    if (!baseUrl) throw new Error('OCTO baseUrl is required');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.capabilities = capabilities;
    this.fetch = fetchImpl;
  }

  async request(method, path, body) {
    const res = await this.fetch(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Octo-Capabilities': this.capabilities,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const detail = data && typeof data === 'object' ? (data.errorMessage || data.error || JSON.stringify(data)) : text;
      throw new OctoError(`OCTO ${method} ${path} failed (${res.status}): ${detail}`, { status: res.status, body: data });
    }
    return data;
  }

  getSupplier() { return this.request('GET', '/supplier'); }
  getProducts() { return this.request('GET', '/products'); }
  getProduct(id) { return this.request('GET', `/products/${encodeURIComponent(id)}`); }

  // body: { productId, optionId, localDateStart, localDateEnd, units?: [{id, quantity}] }
  getAvailability(body) { return this.request('POST', '/availability', body); }

  // body: { uuid?, productId, optionId, availabilityId, unitItems: [{unitId}], notes?, resellerReference? }
  reserve(body) { return this.request('POST', '/bookings', body); }

  // body: { contact, resellerReference?, emailReceipt? }
  confirm(uuid, body) { return this.request('POST', `/bookings/${encodeURIComponent(uuid)}/confirm`, body); }

  getBooking(uuid) { return this.request('GET', `/bookings/${encodeURIComponent(uuid)}`); }

  cancel(uuid, reason) { return this.request('POST', `/bookings/${encodeURIComponent(uuid)}/cancel`, { reason }); }

  // Peek's OCTO webhooks: { url, event }
  createWebhook(body) { return this.request('POST', '/webhooks', body); }
  listWebhooks() { return this.request('GET', '/webhooks'); }
}
