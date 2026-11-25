# Running the connector free on Google Cloud (or Oracle Cloud)

A small always-on server keeps the connector awake and keeps its booking log on
a real disk. HTTPS comes free via `<your-ip>.sslip.io`, so you don't need a
domain. The same scripts work on Google Cloud and Oracle Cloud.

## Google Cloud (free e2-micro)

Google's free tier covers one `e2-micro` server a month in **us-east1,
us-central1 or us-west1**, with a 30 GB **standard** disk. Pick exactly the
options below, or Google bills you for the difference.

### 1. Sign up

Go to <https://console.cloud.google.com>, sign in, start the free trial and
add billing (a card is required; free-tier usage isn't charged). Create or pick
a project.

### 2. Create the server

Menu > **Compute Engine > VM instances > Create instance** (enable the Compute
Engine API if asked):

- **Name:** `octapi`
- **Region:** `us-east1` (South Carolina). Any zone.
- **Machine type:** E2 > `e2-micro`.
- **OS and storage > Change:** Ubuntu, *Ubuntu 24.04 LTS (x86/64)*,
  boot disk type **Standard persistent disk**, size **30 GB**.
  (The default "Balanced" disk is *not* free.)
- **Networking > Firewall:** tick **Allow HTTP traffic** and **Allow HTTPS traffic**.
- **Advanced > Management > Automation > Startup script:** paste the whole of
  [`gcp-startup.sh`](gcp-startup.sh).

Click **Create** and copy the **External IP**.

Keep the server running. If it's ever stopped and started again, Google may
give it a new IP: re-run `sudo bash /opt/octapi/deploy/vm/install.sh` and
`npm run register-webhook` afterwards (or reserve a static IP under *VPC
network > IP addresses*).

### 3. Check it's up (about 5 minutes later)

Open `https://<external-ip-with-dashes>.sslip.io/health`, for example
`https://34-75-1-2.sslip.io/health`. It should show `{"ok":true}`.

### 4. Add the Peek keys (once Peek issues them)

On the VM list click **SSH** next to `octapi` (opens a terminal in the browser)
and run:

```bash
sudo bash /opt/octapi/deploy/vm/configure.sh
```

It asks for both keys (hidden as you type), maps the 9 Cornerstone tours,
restarts the connector and registers the Peek webhook.

## Oracle Cloud (Always Free) instead

1. Sign up at <https://signup.cloud.oracle.com> and pick a home region.
2. **Compute > Instances > Create instance:** Canonical Ubuntu 24.04, shape
   *Ampere* `VM.Standard.A1.Flex` 1 OCPU / 6 GB (or `VM.Standard.E2.1.Micro`
   if Ampere is out of capacity), public IPv4 on, save the SSH key. Under
   *Advanced > Management* paste [`cloud-init.yaml`](cloud-init.yaml).
3. Subnet > Security List > **Add Ingress Rule**: source `0.0.0.0/0`, TCP,
   ports `80,443`.
4. Check `https://<ip-with-dashes>.sslip.io/health`, then (Connect > Cloud
   Shell or SSH) run `sudo bash /opt/octapi/deploy/vm/configure.sh`.

## Everyday commands

```bash
sudo journalctl -u octapi -f                 # live log
sudo bash /opt/octapi/deploy/vm/update.sh    # pull the latest code and restart
sudo grep INTAKE /opt/octapi/.env            # login for /bookings and reports
```

## If something's wrong

- **Health page doesn't load:** check the firewall step, then
  `sudo cat /var/log/octapi-install.log`.
- **Re-run the setup:** `sudo bash /opt/octapi/deploy/vm/install.sh` (safe to repeat).
