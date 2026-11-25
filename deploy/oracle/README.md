# Running the connector free on Oracle Cloud

An Oracle Cloud "Always Free" server keeps the connector awake and keeps its
booking log on a real disk. Setup is about 20 minutes, most of it Oracle's
sign-up. HTTPS comes free via `<your-ip>.sslip.io`, so you don't need a domain.

## 1. Sign up

Create an account at <https://signup.cloud.oracle.com>. Oracle asks for a card
to verify you; Always Free resources aren't charged. Pick a **home region**
close to you (for example US East, Ashburn). It can't be changed later.

## 2. Create the server

Console menu > **Compute > Instances > Create instance**:

- **Image:** Canonical Ubuntu 24.04 (or 22.04).
- **Shape:** *Ampere* > `VM.Standard.A1.Flex`, 1 OCPU, 6 GB memory (marked
  "Always Free-eligible"). If Oracle says it's out of capacity, use *Specialty
  and previous generation* > `VM.Standard.E2.1.Micro` instead, also free.
- **Networking:** keep the defaults (new public subnet) and make sure
  **Assign a public IPv4 address** is on.
- **SSH keys:** *Save private key*, keep the file somewhere safe.
- **Show advanced options > Management > Paste cloud-init script:** paste the
  whole of [`cloud-init.yaml`](cloud-init.yaml).

Click **Create**, then copy the instance's **Public IP address**.

## 3. Open ports 80 and 443

On the instance page: **Subnet** link > **Security** (or *Security Lists*) >
**Default Security List** > **Add Ingress Rules**:

| Source CIDR | IP protocol | Destination port range |
|---|---|---|
| `0.0.0.0/0` | TCP | `80,443` |

## 4. Check it's up (about 5 minutes after creating)

Open `https://<public-ip-with-dashes>.sslip.io/health`, for example
`https://129-80-1-2.sslip.io/health`. It should show `{"ok":true}`.

## 5. Add the Peek keys (once Peek issues them)

On the instance page click **Connect > Cloud Shell** (or SSH in as `ubuntu`
with the saved key), then run:

```bash
sudo bash /opt/octapi/deploy/oracle/configure.sh
```

It asks for both keys (hidden as you type), maps the 9 Cornerstone tours,
restarts the connector and registers the Peek webhook.

## Everyday commands

```bash
sudo journalctl -u octapi -f                     # live log
sudo bash /opt/octapi/deploy/oracle/update.sh    # pull the latest code and restart
sudo cat /opt/octapi/.env | grep INTAKE          # login for /bookings and reports
```

`/bookings` and `/reports/commission` on your sslip.io address use the
`INTAKE_USER` / `INTAKE_PASS` login.

## If something's wrong

- **Health page doesn't load:** check step 3, then `sudo cat /var/log/octapi-install.log`.
- **Re-run the setup:** `sudo bash /opt/octapi/deploy/oracle/install.sh` (safe to repeat).
