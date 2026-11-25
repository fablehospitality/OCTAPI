#!/usr/bin/env bash
# Google Cloud startup script. Paste this whole file into the VM's
# "Advanced options > Management > Automation > Startup script" when creating it.
# It runs on every boot but only installs once.
# Progress log on the server: /var/log/octapi-install.log
if [ ! -f /opt/octapi/.installed ]; then
  apt-get update -y && apt-get install -y git curl
  [ -d /opt/octapi/.git ] || git clone https://github.com/fablehospitality/octapi /opt/octapi
  bash /opt/octapi/deploy/vm/install.sh > /var/log/octapi-install.log 2>&1 && touch /opt/octapi/.installed
fi
