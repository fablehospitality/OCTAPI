#!/usr/bin/env bash
# Pulls the latest connector code and restarts it:
#   sudo bash /opt/octapi/deploy/oracle/update.sh
set -euo pipefail
cd /opt/octapi
sudo -u octapi git pull --ff-only
systemctl restart octapi
sleep 2
journalctl -u octapi -n 5 --no-pager
