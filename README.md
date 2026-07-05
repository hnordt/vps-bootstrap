# VPS Bootstrap

Provision a hardened Node.js VPS in about 5 minutes: one interactive command
creates the instance, and cloud-init sets up the firewall, TLS, a sample app
with a SQLite database, and continuous backups.

The cloud-init template is provider-agnostic and works with any VPS provider
that accepts cloud-init user data. The repository ships an automated
deployment script for Vultr; for other providers, see
[Manual Provider Setup](#manual-provider-setup).

## Quick Start

You need:

- Node.js v22.18.0+ and npm
- A [Vultr API key](https://my.vultr.com/settings/#settingsapi) with permission
  to create instances
- An SSH public key, such as the contents of `~/.ssh/id_ed25519.pub`
- A domain on Cloudflare that you can point at the new server

**1. Create the instance:**

```bash
npm install
npm run vultr
```

Answer the prompts: region, plan (a 1 vCPU / 1 GB plan is preselected when
available), operating system (favor the newest Ubuntu LTS), your domain, your
SSH public keys (comma-separated), and your Vultr API key. The script creates
the instance and prints its Vultr Console URL.

**2. Point DNS at the server:**

1. Open the printed Vultr Console URL and copy the instance's public IPv4
   address.
2. In Cloudflare DNS, create an `A` record for your domain pointing to that
   address, with proxy status **Proxied**.
3. In Cloudflare SSL/TLS settings, set the encryption mode to **Full** (switch
   to **Full (strict)** once the origin certificate is issued).

Keep the record **Proxied**: the firewall only accepts HTTP/HTTPS from
Cloudflare's IP ranges, so a **DNS only** record takes the site down (see
[DNS And TLS](#dns-and-tls)).

**3. Verify:**

Provisioning takes a few minutes and ends with a reboot. Then:

```bash
curl https://YOUR_DOMAIN
```

You should see a visit count read from the SQLite database:

```txt
Visits: 1
```

That's it. Next steps: replace the sample app with your own
([Deploy Your App](#deploy-your-app)), add secrets
([App Config And Secrets](#app-config-and-secrets)), and move backups
off-instance ([Database And Backups](#database-and-backups)).

## What It Creates

The cloud-init template targets Debian-based distributions, favoring current Ubuntu LTS releases, and provisions:

- key-only SSH access for a `deploy` user, with a locked root account
- unattended package upgrades
- UFW firewall: SSH rate-limited, HTTP/HTTPS allowed only from
  Cloudflare-proxied IP ranges
- fail2ban for SSH protection, with Python systemd bindings installed so
  the `systemd` backend is available without relying on package recommends
- Node.js 22.x from the NodeSource APT repository
- a sample Node.js visit-counter app bound to `127.0.0.1:3000`, backed by
  the built-in `node:sqlite` module when available
- a root-owned app environment file at `/etc/app/.env`
- Caddy as the public reverse proxy, configured with [baseline HTTP security
  headers](#http-security-headers)
- Litestream, installed from its GitHub-released Debian package, replicating
  the app database to `/var/backups/app`, with off-site replication as a
  post-provisioning switch

The resulting request path is:

```txt
browser -> Cloudflare -> 80/443 -> Caddy -> 127.0.0.1:3000 -> Node app -> SQLite at /var/lib/app/app.db
```

## Files

- `src/cloud-config.yaml`: cloud-init template. It contains placeholders for
  generated values.
- `src/vultr.ts`: interactive Vultr deployment script. It renders the template
  and sends it as instance user data.
- `package.json`: exposes the `npm run vultr` command.

Template placeholders:

- `${{ __SSH_AUTHORIZED_KEYS__ }}`: replaced with a JSON-style YAML array of
  SSH public keys.
- `${{ __PUBLIC_DOMAIN__ }}`: replaced with the domain Caddy should serve.

The Vultr script reads the template, replaces the placeholders,
base64-encodes the result, and sends it as instance user data. The rendered
cloud-config is not written to a local file.

## Manual Provider Setup

To use the bootstrap template without the Vultr automation:

1. Copy the contents of `src/cloud-config.yaml`.
2. Replace `${{ __SSH_AUTHORIZED_KEYS__ }}` with a YAML array of SSH public
   keys.
3. Replace `${{ __PUBLIC_DOMAIN__ }}` with the domain Caddy should serve.
4. Paste the rendered cloud-init config into your provider's user-data or
   cloud-init field when creating the instance.

Make sure the selected server image supports cloud-init. The template targets
Debian-based distributions and favors current Ubuntu LTS releases.

## Verify The Server

SSH into the server as `deploy` (SSH is direct — use the server public IP or
an unproxied DNS record; Cloudflare's proxied records do not proxy SSH):

```bash
ssh deploy@YOUR_SERVER_IP
```

Check cloud-init and services:

```bash
cloud-init status --long
sudo ufw status verbose
sudo systemctl status app
sudo systemctl status caddy
sudo systemctl status fail2ban
sudo systemctl status litestream
```

Check the app locally and through Cloudflare:

```bash
curl -i http://127.0.0.1:3000
curl -I https://YOUR_DOMAIN
```

Check that Litestream is replicating the database:

```bash
sudo journalctl -u litestream
sudo ls /var/backups/app
```

The journal should show an `initialized db` line followed by periodic
`snapshot complete` and `compaction complete` lines, and the backup directory
should contain an `ltx` subdirectory.

## Deploy Your App

The visit-counter server is a placeholder. The intended workflow is to replace
it with your real app — typically a compiled or bundled build — through the
`deploy` user.

`/opt/app` is owned by root on purpose: the `app` service user cannot modify
its own code, so a compromised app cannot rewrite what the service executes.
Deploys write through the `deploy` user's passwordless sudo instead.

A minimal deploy script, run from your workstation or CI, uploads the build to
the deploy user's home directory, installs it into `/opt/app` as root, and
restarts the service:

```bash
#!/bin/sh
set -eu

host="deploy@YOUR_SERVER_IP"

scp dist/server.mjs "$host:server.mjs.next"
ssh "$host" "
  sudo install -o root -g root -m 0644 server.mjs.next /opt/app/server.mjs
  rm server.mjs.next
  sudo systemctl restart app
  systemctl is-active app
"
```

If your build outputs a compiled binary instead of a Node.js entrypoint,
install it with mode `0755` and update `ExecStart` once:

```bash
sudoedit /etc/systemd/system/app.service
# ExecStart=/opt/app/server
sudo systemctl daemon-reload
sudo systemctl restart app
```

Nothing else changes on deploy: the app keeps writing to
`/var/lib/app/app.db`, Litestream keeps replicating it, and `/etc/app/.env` is
preserved. If a deploy needs new config values, update `/etc/app/.env` before
restarting (see [App Config And Secrets](#app-config-and-secrets)).

## App Config And Secrets

The `app` systemd service loads environment variables from
`/etc/app/.env` at startup when the file exists.

This env file is created by cloud-init, but the service treats it as optional
so `app` can still start if the file is not present yet. Values in
`/etc/app/.env` should use systemd environment-file syntax:

```ini
DATABASE_URL=postgres://user:password@example.internal/app
SESSION_SECRET=replace-me
```

The file is written as `root:app` with `0640` permissions. That lets the app
service read it while keeping it unavailable to normal users. To change values
after provisioning, edit the file as root and restart the service:

```bash
sudoedit /etc/app/.env
sudo systemctl restart app
```

The sample app and Caddy upstream are both bound to `127.0.0.1:3000`. If you
change the app listener, update the Caddy `reverse_proxy` target at the same
time instead of setting only `PORT` in `/etc/app/.env`.

Do not commit real secrets to `src/cloud-config.yaml`. Cloud-init user data is
sent to the VPS provider, may be retained by the provider, and can be read from
inside the instance by privileged users. Prefer adding production secrets after
the instance is created, or inject them through a provider secret mechanism if
your deployment target supports one.

## Database And Backups

The sample app opens a SQLite database with Node.js's built-in `node:sqlite`
module, so no npm dependencies are needed. Cloud-init installs Node.js 22.x
from the NodeSource repository before starting the app because Ubuntu's distro
`nodejs` package may be too old to provide `node:sqlite`. If `node:sqlite` is
unavailable, the server fails during startup instead of serving traffic with
non-persistent state.

When SQLite is available, the database lives at `/var/lib/app/app.db`. The
`app` service uses `StateDirectory=app`, so systemd creates `/var/lib/app`
owned by the `app` user, and it is the only path the hardened service can write
to. The directory is created with `0700` permissions
(`StateDirectoryMode=0700`) and the service runs with `UMask=0077`, so the
database and WAL files are not readable by other service accounts, such as
`caddy`. The app reads the directory from the `STATE_DIRECTORY` environment
variable that systemd sets, and falls back to the current directory when run
outside systemd. On startup the app enables WAL journal mode, which Litestream
requires, creates a `counters` table, and increments the `visits` counter on
every request.

Litestream continuously replicates the database. Cloud-init writes its
configuration to `/etc/litestream.yml`, and the default replica is a local
directory, `/var/backups/app`, which Litestream creates on first sync. This
works with no credentials, so backups run from first boot. A local replica
protects against application-level damage, like a bad migration, corruption,
or an accidental delete, but not against losing the disk or the instance. For
real disaster recovery, switch the replica to off-instance storage.

To switch to an S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2,
MinIO), edit the config as root:

```bash
sudoedit /etc/litestream.yml
```

Replace the `replica` block with your bucket and credentials:

```yaml
dbs:
  - path: /var/lib/app/app.db
    replica:
      url: s3://your-bucket/app
      access-key-id: your-key-id
      secret-access-key: your-secret
```

Then restart the service and watch for a successful sync:

```bash
sudo systemctl restart litestream
sudo journalctl -u litestream -f
```

The config file is `root:root` with `0600` permissions so replica credentials
stay readable by root only. Do not put real credentials in
`src/cloud-config.yaml` itself (see
[App Config And Secrets](#app-config-and-secrets)). For non-AWS providers, add
an `endpoint` field to the replica; `/etc/litestream.yml` ships with a
commented Cloudflare R2 example, which uses the account-scoped endpoint and
`region: auto`. See the [Litestream guides](https://litestream.io/guides/) for
other provider-specific settings.

To restore the database from the replica, stop both the app and Litestream so
replication cannot observe a half-restored database, remove the damaged
database files (`litestream restore` refuses to overwrite an existing
database) together with Litestream's local `app.db-litestream` metadata
directory so the next sync does not compare the restored database against
stale tracking state, restore, return ownership to the `app` user, and start
both services again:

```bash
sudo systemctl stop app litestream
sudo rm -rf /var/lib/app/app.db /var/lib/app/app.db-wal /var/lib/app/app.db-shm /var/lib/app/app.db-litestream
sudo litestream restore /var/lib/app/app.db
sudo chown app:app /var/lib/app/app.db*
sudo systemctl start litestream app
```

## DNS And TLS

This bootstrap assumes Cloudflare is the external HTTP/HTTPS proxy.

During provisioning, cloud-init fetches Cloudflare's current IPv4 and IPv6
ranges from `https://www.cloudflare.com/ips-v4` and
`https://www.cloudflare.com/ips-v6`, then creates UFW allow rules for `80/tcp`
and `443/tcp` from those ranges only. Direct origin HTTP/HTTPS requests from
non-Cloudflare IP addresses are blocked by UFW.

Because Caddy obtains public certificates through ACME HTTP-01, keep the DNS
record **Proxied** at all times: Caddy renews certificates automatically in the
background, and renewal has the same reachability requirement as first
issuance. With this firewall policy, Let's Encrypt can only reach the HTTP-01
challenge through Cloudflare's proxy. If you switch the record to **DNS only**,
the site goes down immediately: browsers connect directly to the origin from
non-Cloudflare IP addresses, and UFW blocks them. Certificate renewal also
fails while the record is DNS only. Check `journalctl -u caddy` for renewal
errors, renewals can also fail silently while **Proxied** if a Cloudflare
redirect or WAF rule interferes with the HTTP-01 challenge path.

If you stay **Proxied** and want to remove the ACME reachability dependency
entirely, use a Cloudflare origin certificate or configure Caddy for DNS-01
validation. If you want a **DNS only** record instead, you must also open ports
80 and 443 to all sources in UFW — the Cloudflare-only rules block every
visitor, not just Let's Encrypt — after which standard certificate issuance
works directly. Note that Cloudflare origin certificates only work behind the
proxy; browsers do not trust them on direct connections.

The VPS does not automatically refresh Cloudflare IP ranges after provisioning.
Cloudflare changes these ranges infrequently, and this keeps the generated UFW
configuration immutable unless you intentionally update it. If Cloudflare
publishes new ranges that your site needs, update the UFW allow rules
deliberately and audit the resulting firewall state.

UFW is enabled with the default-deny policy before the Cloudflare IP ranges are
fetched. If the fetch fails, the origin fails closed: SSH stays reachable, but
HTTP/HTTPS remains blocked until the Cloudflare allow rules are added.

Caddy is configured for the domain you entered and forwards Cloudflare's
`CF-Connecting-IP` value as `X-Forwarded-For`, so the Node.js app can receive
the original visitor IP through the forwarded header.

For Cloudflare SSL/TLS mode, use **Full** or **Full (strict)**. Use **Full** if
the origin certificate is not yet valid for strict verification. Use
**Full (strict)** after the origin has a certificate Cloudflare can validate.

## HTTP Security Headers

This repository's Caddy setup adds baseline HTTP security headers to every
response served by the public site block:

```txt
Strict-Transport-Security: max-age=31536000
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
```

These headers define the following browser-side defaults:

- HTTPS is required for future requests to the configured domain.
- Browsers should not MIME-sniff responses away from their declared content
  type.
- The site cannot be embedded in a frame.
- Cross-origin referrers expose only the origin instead of the full URL.

The HSTS header intentionally does not include `includeSubDomains` or
`preload`. Add `includeSubDomains` only if every subdomain is HTTPS-ready. Add
`preload` only if the root domain and all subdomains are permanently
HTTPS-only and you intend to submit the domain to the browser preload list.

## Customization

To change what the server provisions, edit `src/cloud-config.yaml`.

Common changes:

- Replace `/opt/app/server.mjs` with your application bootstrap.
- Adjust `ExecStart` in `app.service` if your deploy ships something other
  than `node server.mjs`, such as a compiled binary.
- Change `/etc/caddy/Caddyfile` for routing, headers, or additional domains.
- Adjust UFW rules if the server should only accept traffic from a trusted
  edge.
- Change `/etc/litestream.yml` if your app uses a different database path or
  needs provider-specific replica settings.

To change Vultr-specific defaults, edit `src/vultr.ts`.

Common changes:

- the operating system selector, which lists Vultr's Ubuntu and Debian images
  newest-first.
- the plan selector, which preselects a 1 vCPU / 1 GB plan when the region
  offers one.
- instance creation options in the `/v2/instances` request body.

## Security Notes

Do not commit real credentials.

The Vultr API key is entered interactively and is not stored by this
repository. The SSH public keys and domain are embedded in the cloud-init user
data sent to Vultr.

Cloud-init user data may be retained by the VPS provider and may be readable
from inside the instance by privileged users. See
[App Config And Secrets](#app-config-and-secrets) before adding long-lived
production secrets.

Before using this as a production baseline, review:

- whether your provisioning environment can reach Cloudflare's IP range
  endpoints
- whether the app service should run your real app instead of the sample
  visit-counter server
- whether the default security headers match your embedding, referrer, and
  subdomain policy
- whether the default local-directory Litestream replica is enough, or whether
  backups belong off-instance
- whether your DNS and HTTPS setup matches your edge provider
