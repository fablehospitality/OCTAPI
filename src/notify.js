// Sends alerts to a webhook (Slack incoming webhook, Zapier catch hook, etc.)
// and always logs them. Alerts are for things a person must act on, such as
// a booking that could not be placed with the partner.
export function createNotifier({ alertWebhookUrl, fetchImpl = fetch, log = console } = {}) {
  return async function notify(title, details = {}) {
    log.warn(`[ALERT] ${title}`, JSON.stringify(details));
    if (!alertWebhookUrl) return;
    const text = `${title}\n` + Object.entries(details).map(([k, v]) => `• ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n');
    try {
      await fetchImpl(alertWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, title, ...details }),
      });
    } catch (err) {
      log.error('Failed to send alert:', err.message);
    }
  };
}
