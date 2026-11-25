#!/usr/bin/env bash
# Run once the two Peek OCTO API keys arrive:
#   sudo bash /opt/octapi/deploy/vm/configure.sh
# Asks for the keys (typing is hidden), saves them, maps the Cornerstone
# tours, restarts the connector and, if you say yes, registers the webhook
# so your Peek sends bookings here.
set -euo pipefail
APP=/opt/octapi
ENV="$APP/.env"
cd "$APP"
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
[ -f "$ENV" ] || { echo "$ENV missing: run install.sh first."; exit 1; }

set_var() { # set_var NAME VALUE, without the value ever touching the shell history or ps
  NAME="$1" VALUE="$2" ENVFILE="$ENV" node -e '
    const fs = require("fs"); const f = process.env.ENVFILE;
    const line = `${process.env.NAME}=${process.env.VALUE}`;
    let t = fs.readFileSync(f, "utf8");
    const re = new RegExp(`^${process.env.NAME}=.*$`, "m");
    t = re.test(t) ? t.replace(re, () => line) : t.replace(/\n?$/, "\n") + line + "\n";
    fs.writeFileSync(f, t);'
}
ask_secret() { # ask_secret NAME "prompt"; Enter keeps the current value
  local v; read -r -s -p "$2 (Enter to keep current): " v; echo
  [ -n "$v" ] && set_var "$1" "$v" || true
}
as_app() { sudo -u octapi "$@"; }

echo "Paste each key and press Enter. Nothing shows while you type."
ask_secret MY_OCTO_API_KEY "Your own Peek OCTO API key (Fable Hospitality)"
ask_secret PARTNER_OCTO_API_KEY "Cornerstone's reseller OCTO API key"
read -r -p "Slack/Zapier alert webhook URL (optional, Enter to skip): " alert
[ -n "$alert" ] && set_var ALERT_WEBHOOK_URL "$alert"
chown octapi:octapi "$ENV"; chmod 600 "$ENV"

echo; echo "== Matching your 9 Cornerstone tours"
as_app node scripts/build-mappings.js
read -r -p "Save these mappings? [y/N] " ok
if [[ "$ok" =~ ^[Yy] ]]; then as_app node scripts/build-mappings.js --write; fi

echo; echo "== Restarting the connector"
systemctl restart octapi; sleep 3
journalctl -u octapi -n 5 --no-pager
URL=$(grep '^PUBLIC_URL=' "$ENV" | cut -d= -f2-)
if curl -fsS "$URL/health" >/dev/null; then echo "Reachable at $URL"; else
  echo "Not reachable at $URL yet. Check ports 80 and 443 are open in your cloud firewall (see deploy/vm/README.md)."; exit 1; fi

echo; echo "== Peek webhook"
echo "Registering tells your Peek to send booking updates here. Do this only once."
read -r -p "Register it now? [y/N] " ok
if [[ "$ok" =~ ^[Yy] ]]; then as_app node scripts/register-webhook.js; fi

echo; echo "Done. Make a test booking on a Cornerstone tour, then check:"
echo "  sudo journalctl -u octapi -f"
