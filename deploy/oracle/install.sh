#!/usr/bin/env bash
# Sets up the connector on a fresh Oracle Cloud Ubuntu server (run as root;
# cloud-init.yaml runs it for you). Safe to run again.
#   - Node.js 22, the connector as a service that restarts on failure/reboot
#   - Caddy in front, with a free HTTPS certificate for <ip>.sslip.io
#   - availability watcher every 15 minutes
#   - a starter .env with random webhook credentials (API keys added later
#     with: sudo bash /opt/octapi/deploy/oracle/configure.sh)
set -euo pipefail
APP=/opt/octapi
export DEBIAN_FRONTEND=noninteractive

echo "== Packages"
apt-get update -y
apt-get install -y git curl ca-certificates gnupg openssl debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

if ! node --version 2>/dev/null | grep -q '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== App user and code"
id octapi >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin octapi
[ -d "$APP/.git" ] || git clone https://github.com/fablehospitality/octapi "$APP"
mkdir -p "$APP/data"
chown -R octapi:octapi "$APP"

echo "== Firewall (Oracle's Ubuntu image blocks 80/443 by default)"
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
netfilter-persistent save

echo "== Address"
IP=$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)
HOST="${IP//./-}.sslip.io"
echo "Public address: https://$HOST"

echo "== Settings (.env)"
ENV="$APP/.env"
if [ ! -f "$ENV" ]; then
  cp "$APP/.env.example" "$ENV"
  sed -i "s|^INTAKE_USER=.*|INTAKE_USER=peek-$(openssl rand -hex 6)|" "$ENV"
  sed -i "s|^INTAKE_PASS=.*|INTAKE_PASS=$(openssl rand -hex 24)|" "$ENV"
fi
sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$HOST|" "$ENV"
chown octapi:octapi "$ENV"; chmod 600 "$ENV"

echo "== Service"
cat > /etc/systemd/system/octapi.service <<EOF
[Unit]
Description=Peek OCTO connector
After=network-online.target
Wants=network-online.target

[Service]
User=octapi
WorkingDirectory=$APP
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now octapi
systemctl restart octapi

echo "== HTTPS"
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
  reverse_proxy 127.0.0.1:3000
}
EOF
systemctl enable caddy
systemctl restart caddy

echo "== Availability watcher (every 15 min)"
cat > /etc/cron.d/octapi-watch <<EOF
*/15 * * * * octapi cd $APP && /usr/bin/node scripts/watch-availability.js >> $APP/data/watch.log 2>&1
EOF

echo "== Done. Connector: https://$HOST/health"
echo "Next: sudo bash $APP/deploy/oracle/configure.sh"
