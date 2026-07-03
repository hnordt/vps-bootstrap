# VPS Bootstrap

Cloud-init setup for running a small production-oriented Node.js server on a VPS provider behind Cloudflare.

The default setup targets Ubuntu 24.04 LTS and includes:

- Node.js
- Cloudflare as the public edge
- Caddy as the origin HTTPS reverse proxy
- systemd services for the application and Litestream
- SQLite with WAL mode
- UFW firewall rules
- fail2ban
- unattended security upgrades
- key-only SSH access

## Goal

This repository provides a predictable baseline for a small VPS.

```txt
browser -> Cloudflare edge -> 443 -> Caddy -> 127.0.0.1:3000 -> Node app -> SQLite
```

The application should listen on `127.0.0.1`. Cloudflare should be the public HTTP entrypoint, and Caddy should only accept HTTPS from Cloudflare IP ranges.

The cloud-config file is the source of truth for the generated systemd units and Caddy configuration.

## Deployment Setup

Use `cloud-config.yaml` with any VPS provider that supports cloud-init user data, such as Vultr, DigitalOcean, Hetzner, Linode, AWS Lightsail, or another Ubuntu VPS host. Provider field names vary; use the field that accepts `#cloud-config` user data, not a shell-only startup script.

1. Choose an Ubuntu 24.04 LTS image.
2. Choose a region close to your users.
3. Create a Cloudflare Origin Certificate for the app hostname you will use as `__DOMAIN__`.
4. Replace every placeholder value in `cloud-config.yaml`, including the SSH public key, Cloudflare certificate, object storage settings, and Litestream checksums.
5. Create the VPS and paste `cloud-config.yaml` into the provider's cloud-init or user data field.
6. Copy the VPS public IPv4 address from the provider console.
7. In Cloudflare, create a proxied `A` record for `__DOMAIN__` pointing to the VPS public IPv4 address.
8. Set Cloudflare SSL/TLS mode to `Full (strict)`.
9. Wait for cloud-init to finish, then connect as the `deploy` user and verify the services.

```bash
ssh deploy@YOUR_SERVER_IP
cloud-init status --long
sudo ufw status verbose
sudo systemctl status app
sudo systemctl status caddy
sudo systemctl status litestream
curl -I https://app.example.com/health
```

Use `cloud-config.yaml` when the domain is proxied through Cloudflare and you do not want the origin exposed directly on public HTTPS.

The VPS firewall allows SSH and allows HTTPS only from Cloudflare IP ranges.

Cloudflare Origin Certificates secure the connection between Cloudflare and the origin server. They are compatible with Full (strict) mode, but they are not browser-trusted certificates if someone bypasses Cloudflare and connects directly to the origin.

The template keeps port 80 closed. Cloudflare can handle HTTP to HTTPS redirects at the edge.

The template syncs Cloudflare IP ranges into UFW at boot and then weekly through a systemd timer.

Because traffic reaches your VPS from Cloudflare, the app must read the real client IP from `CF-Connecting-IP`; the direct peer address will be a Cloudflare address.

Placeholder reference:

- `__SSH_PUBLIC_KEY__`: The SSH public key allowed to log in as the `deploy` user. Use the public half of your key, such as the contents of `~/.ssh/id_ed25519.pub`.
- `__DOMAIN__`: The app hostname Caddy serves, such as `app.example.com`. This should match the proxied Cloudflare DNS record and Origin Certificate hostname.
- `__CLOUDFLARE_ORIGIN_CERT_PEM__`: The Cloudflare Origin Certificate PEM for `__DOMAIN__`. Caddy uses this certificate for HTTPS between Cloudflare and the VPS.
- `__CLOUDFLARE_ORIGIN_KEY_PEM__`: The private key paired with the Cloudflare Origin Certificate. Keep it secret.
- `__S3_ENDPOINT__`: The S3-compatible object storage endpoint used by Litestream, such as a regional S3, R2, Spaces, or Object Storage endpoint.
- `__S3_REGION__`: The object storage region expected by the S3-compatible API.
- `__S3_BUCKET__`: The bucket where Litestream stores SQLite backup snapshots and WAL segments.
- `__S3_ACCESS_KEY_ID__`: The access key Litestream uses to write to the backup bucket.
- `__S3_SECRET_ACCESS_KEY__`: The secret key paired with `__S3_ACCESS_KEY_ID__`. Keep it secret and scope it to the backup bucket or path.
- `__LITESTREAM_SHA256_AMD64__`: The SHA256 checksum for the pinned Litestream Linux `amd64` release archive.
- `__LITESTREAM_SHA256_ARM64__`: The SHA256 checksum for the pinned Litestream Linux `arm64` release archive.

## Secrets

Do not commit real credentials.

Do not place production long-lived secrets directly in cloud-init user data when you can avoid it. User data may be retained by the VPS provider and may be readable from inside the instance through the provider metadata service, not only by `root`.

For production, prefer this flow:

1. Deploy with placeholder or temporary credentials.
2. Upload final secret files over SSH after the server boots.
3. Store backup credentials in files readable only by the `litestream` user or group.
4. Keep the application user unable to read backup credentials.
5. Use object storage credentials scoped to the one backup bucket or path.
6. Enable bucket versioning. Use object lock if you need stronger protection against destructive backup deletion.

## Litestream

Litestream 0.5 uses a single `replica` field in the configuration file.

The template uses the v0.5 configuration shape and pins the Litestream release URL to `v0.5.13`.

The template requires architecture-specific SHA256 placeholders to be replaced before deployment:

```txt
__LITESTREAM_SHA256_AMD64__
__LITESTREAM_SHA256_ARM64__
```

This makes provisioning deterministic and prevents running a dynamically selected GitHub release as `root` without integrity verification.

When upgrading Litestream:

1. Choose the new release version.
2. Update `LITESTREAM_VERSION` in `cloud-config.yaml`.
3. Download the release artifacts for each target architecture.
4. Compute the SHA256 checksum for each artifact.
5. Replace the checksum placeholders in the deployed template.
6. Test restore and replication on a disposable VPS before using the new version in production.

For disposable manual testing, this snippet installs the latest Litestream release for the current architecture. Production provisioning should use the pinned version and SHA256 verification in `cloud-config.yaml`.

```bash
ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64) LITESTREAM_ARCH="amd64" ;;
  arm64) LITESTREAM_ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
esac

LITESTREAM_URL="$(
  curl -fsSL https://api.github.com/repos/benbjohnson/litestream/releases/latest \
    | jq -r ".assets[] | select(.name | test(\"linux-${LITESTREAM_ARCH}.*tar.gz$\")) | .browser_download_url" \
    | head -n 1
)"

test -n "$LITESTREAM_URL"
curl -fsSL "$LITESTREAM_URL" -o /tmp/litestream.tar.gz
tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream
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
- [ ] Only `22/tcp` and Cloudflare-sourced `443/tcp` are open.
- [ ] Cloudflare IP sync fetches and validates the new list before deleting existing allow rules.

Application boundary:

- [ ] The Node app binds to `127.0.0.1`, not `0.0.0.0`.
- [ ] Cloudflare is the public HTTP entrypoint.
- [ ] Caddy only accepts HTTPS from Cloudflare IP ranges.
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
- [ ] Litestream release archives are verified with SHA256 before extraction.
- [ ] SHA256 placeholders are replaced before deployment.

Operations:

- [ ] Security updates are enabled.
- [ ] Disk usage is monitored.
- [ ] `/health` is monitored.
- [ ] Logs are retained but bounded.

## License

MIT
