# VPS Bootstrap

Cloud-init setup for running a production-oriented Node.js server on a single VPS with Caddy-managed HTTPS.

The default setup targets Ubuntu 24.04 LTS and includes:

- Node.js
- Caddy as the public HTTPS reverse proxy
- systemd services for the application and Litestream
- SQLite with WAL mode
- UFW firewall rules
- fail2ban
- unattended security upgrades
- key-only SSH access

## Goal

This repository provides a predictable baseline for a single-VPS deployment.

```txt
browser -> 80/443 -> Caddy -> 127.0.0.1:3000 -> Node app -> SQLite
```

The application should listen on `127.0.0.1`. Caddy is the public HTTP and HTTPS entrypoint and manages certificates automatically.

The cloud-config file is the source of truth for the baseline users, packages, systemd units, firewall, and hardening. Site-specific SSH, domain, and backup settings are installed after first boot so the cloud-config can be copied unchanged.

## Vultr Deployment

The quickest path is the Vultr provisioning script. It creates the VPS, passes `cloud-config.yaml` as cloud-init user data, waits for the server to finish bootstrapping, uploads the site-specific files, restores or creates the SQLite database, and starts Caddy and Litestream.

DNS is intentionally out of scope for now. The script prints the new Vultr IPv4 address and waits for your domain's `A` record to point at it before starting Caddy, so Caddy can request certificates automatically.

Requirements:

- Node.js 18 or newer on your local machine.
- `ssh` and `scp` available locally.
- A Vultr API key in `VULTR_API_KEY`.
- A local SSH key pair for server access.
- DNS control for your app hostname.

Create a private config file:

```bash
cp deploy.config.example.json deploy.config.json
```

Edit `deploy.config.json` with your Vultr region, plan, OS choice, domain, SSH key paths, ACME email, and Litestream object storage settings.

Run the deployer:

```bash
VULTR_API_KEY=your-vultr-api-key node scripts/provision-vultr.mjs
```

The script writes `.vps-bootstrap-state.json` after creating resources so a repeated run continues against the same instance instead of creating another VPS.

After the script finishes, deploy your Node app into `/opt/app/current` and start the app service:

```bash
ssh deploy@YOUR_SERVER_IP
sudo systemctl start app
```

## Manual Deployment Setup

Use `cloud-config.yaml` with any VPS provider that supports cloud-init user data, such as Vultr, DigitalOcean, Hetzner, Linode, AWS Lightsail, or another Ubuntu VPS host.

1. Choose an Ubuntu 24.04 LTS image.
2. Choose a region close to your users.
3. Add your SSH public key through the VPS provider's normal SSH key setting.
4. Create the VPS and paste the full contents of `cloud-config.yaml`, starting with `#cloud-config`, into the provider's cloud-init or user data field without editing it.
5. Copy the VPS public IPv4 address from the provider console.
6. Wait for cloud-init to finish, then connect as the provider-created user, such as `ubuntu` or `root`.

```bash
ssh ubuntu@YOUR_SERVER_IP
cloud-init status --long
```

The template creates a `deploy` user but does not embed an SSH key in user data. After first login, copy the provider-installed authorized keys into the `deploy` account:

```bash
sudo install -d -o deploy -g app -m 0700 /home/deploy/.ssh
sudo install -o deploy -g app -m 0600 ~/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
```

Reconnect as `deploy`, then disable root SSH login:

```bash
ssh deploy@YOUR_SERVER_IP

printf '%s\n' 'PermitRootLogin no' 'PasswordAuthentication no' \
  | sudo tee /etc/ssh/sshd_config.d/99-vps-bootstrap.conf >/dev/null
sudo systemctl reload ssh || sudo systemctl reload sshd
```

Caddy and Litestream are installed during cloud-init, but they are intentionally left idle until the site-specific files are installed.

Create an `A` record for the app hostname pointing to the VPS public IPv4 address. Caddy uses that DNS record to request and renew certificates automatically.

From your local machine, create these files:

- `Caddyfile`: Caddy site configuration for your domain.
- `litestream.yml`: Litestream object storage configuration.

Example `Caddyfile`:

```caddyfile
{
  admin off
}

app.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

Example `litestream.yml`:

```yaml
dbs:
  - path: /var/lib/app/data.db
    replica:
      type: s3
      endpoint: YOUR_S3_ENDPOINT
      region: YOUR_S3_REGION
      bucket: YOUR_S3_BUCKET
      path: data.db
      access-key-id: YOUR_S3_ACCESS_KEY_ID
      secret-access-key: YOUR_S3_SECRET_ACCESS_KEY
```

Upload the files to a private staging directory:

```bash
ssh deploy@YOUR_SERVER_IP 'install -d -m 0700 ~/secret-upload'
scp ./Caddyfile ./litestream.yml deploy@YOUR_SERVER_IP:~/secret-upload/
```

Install them with the ownership and permissions expected by the systemd services:

```bash
ssh deploy@YOUR_SERVER_IP

sudo install -o root -g root -m 0644 ~/secret-upload/Caddyfile /etc/caddy/Caddyfile
sudo install -o root -g litestream -m 0640 ~/secret-upload/litestream.yml /etc/litestream.yml
rm -rf ~/secret-upload

sudo -u litestream litestream restore \
  -config /etc/litestream.yml \
  -if-db-not-exists \
  -if-replica-exists \
  /var/lib/app/data.db || true
sudo test -f /var/lib/app/data.db || sudo -u app sqlite3 /var/lib/app/data.db "PRAGMA journal_mode=WAL;"
sudo chown app:app /var/lib/app/data.db*
sudo chmod 0660 /var/lib/app/data.db*

sudo systemctl enable --now caddy
sudo systemctl enable --now litestream
```

Verify the server:

```bash
sudo ufw status verbose
sudo systemctl status app
sudo systemctl status caddy
sudo systemctl status litestream
curl -I https://app.example.com/health
```

This setup expects Caddy to be the public entrypoint for your domain.

The VPS firewall allows SSH, HTTP, and HTTPS. Port 80 is required for Caddy's default HTTP-01 certificate challenge.

Caddy handles HTTP to HTTPS redirects and certificate renewal.

## Secrets

Do not commit real credentials.

Do not place production long-lived secrets directly in cloud-init user data when you can avoid it. User data may be retained by the VPS provider and may be readable from inside the instance through the provider metadata service, not only by `root`.

The cloud-config file intentionally contains no site-specific secrets. Upload final secret-backed files over SSH after the server boots.

For production:

1. Store backup credentials in `/etc/litestream.yml`, readable by `root:litestream`.
2. Keep the application user unable to read backup credentials.
3. Use object storage credentials scoped to the one backup bucket or path.
4. Enable bucket versioning. Use object lock if you need stronger protection against destructive backup deletion.

## Litestream

Litestream 0.5 uses a single `replica` field in the configuration file.

The template uses the v0.5 configuration shape and pins the Litestream release URL to `v0.5.13`.

The installer automatically downloads the matching GitHub release archive and the release `checksums.txt` file, then verifies the archive before extracting it as `root`.

Security notice: this removes the manual checksum step while still detecting corrupted or mismatched downloads. It is less strict than storing the expected SHA256 in this repository, because the archive and checksum file are both fetched from the same GitHub release during provisioning. If you need stronger supply-chain control, vendor the expected checksum in `cloud-config.yaml` or install Litestream from a trusted internal package mirror.

When upgrading Litestream:

1. Choose the new release version.
2. Update `LITESTREAM_VERSION` in `cloud-config.yaml`.
3. Confirm the release includes a `checksums.txt` asset and Linux archive for each target architecture.
4. Test restore and replication on a disposable VPS before using the new version in production.

For disposable manual testing, this snippet installs the latest Litestream release for the current architecture and verifies it against the release checksum file. Production provisioning should use the pinned version in `cloud-config.yaml`.

```bash
ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64) LITESTREAM_ARCH="x86_64" ;;
  arm64) LITESTREAM_ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
esac

release_json="$(curl -fsSL https://api.github.com/repos/benbjohnson/litestream/releases/latest)"
LITESTREAM_VERSION="$(printf '%s' "$release_json" | jq -r .tag_name)"
LITESTREAM_FILE="litestream-${LITESTREAM_VERSION#v}-linux-${LITESTREAM_ARCH}.tar.gz"
LITESTREAM_BASE_URL="https://github.com/benbjohnson/litestream/releases/download/${LITESTREAM_VERSION}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "${LITESTREAM_BASE_URL}/${LITESTREAM_FILE}" -o "${tmp}/${LITESTREAM_FILE}"
curl -fsSL "${LITESTREAM_BASE_URL}/checksums.txt" -o "${tmp}/checksums.txt"
cd "$tmp"
grep -F "  ${LITESTREAM_FILE}" checksums.txt | sha256sum -c -
tar -xzf "${LITESTREAM_FILE}" -C /usr/local/bin litestream
chmod 0755 /usr/local/bin/litestream
```

## Restore Test

Backups are only useful if restore is tested.

Stop services:

```bash
sudo systemctl stop app
sudo systemctl stop litestream
```

Move the current database away:

```bash
sudo mv /var/lib/app/data.db /var/lib/app/data.db.bak
sudo rm -f /var/lib/app/data.db-wal /var/lib/app/data.db-shm
```

Restore from object storage:

```bash
sudo -u litestream litestream restore \
  -config /etc/litestream.yml \
  /var/lib/app/data.db
```

Fix ownership:

```bash
sudo chown app:app /var/lib/app/data.db*
sudo chmod 0660 /var/lib/app/data.db*
```

Start services:

```bash
sudo systemctl start litestream
sudo systemctl start app
```

Verify:

```bash
sudo systemctl status litestream
sudo systemctl status app
curl -I https://app.example.com/health
```

Before trusting backups, test a full restore on a scratch VPS.

## Security Checklist

SSH:

- [ ] Root login is disabled.
- [ ] Password login is disabled.
- [ ] Only the `deploy` user can SSH.
- [ ] Your SSH private key is protected with a passphrase.
- [ ] Optional: SSH is restricted to known IP addresses.

Firewall:

- [ ] UFW is enabled.
- [ ] Default incoming policy is deny.
- [ ] Default outgoing policy is allow.
- [ ] Only `22/tcp`, `80/tcp`, and `443/tcp` are open.
- [ ] Optional: SSH is restricted to known IP addresses.

Application boundary:

- [ ] The Node app binds to `127.0.0.1`, not `0.0.0.0`.
- [ ] Caddy is the public HTTP and HTTPS entrypoint.
- [ ] Caddy certificates are issuing and renewing successfully.
- [ ] The database is stored under `/var/lib/app`.
- [ ] Application code is stored outside writable application state.
- [ ] The app does not run as root.
- [ ] The app user cannot overwrite deployed application code.
- [ ] The app user cannot read Litestream backup credentials.

Backups:

- [ ] Litestream is running.
- [ ] Litestream runs as a dedicated `litestream` user.
- [ ] Object storage credentials are not committed.
- [ ] Production object storage credentials are not placed in cloud-init user data when avoidable.
- [ ] Object storage credentials are scoped to the backup bucket or path only.
- [ ] Bucket versioning is enabled.
- [ ] Object lock is enabled if destructive backup deletion must be prevented.
- [ ] Restore has been tested.

Supply chain:

- [ ] Litestream version is pinned.
- [ ] Litestream release archive is verified against the pinned release `checksums.txt` before extraction.
- [ ] You accept the GitHub release checksum trust model, or you vendor the expected SHA256 for stricter supply-chain control.

Operations:

- [ ] Security updates are enabled.
- [ ] Disk usage is monitored.
- [ ] `/health` is monitored.
- [ ] Logs are retained but bounded.
