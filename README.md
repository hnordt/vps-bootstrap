# VPS Bootstrap

Cloud-init setup for running a small production-oriented Node.js server on a VPS provider behind Cloudflare.

The default setup targets Ubuntu LTS and includes:

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

## Template

```txt
cloud-init.yml
```

Caddy uses a Cloudflare Origin Certificate, Cloudflare should be set to Full (strict), and UFW allows port 443 only from Cloudflare IP ranges.

## Repository structure

```txt
cloud-init.yml
docs/
  vultr.md
  cloudflare-origin.md
  security-checklist.md
  litestream-restore.md
  litestream-version.md
```

The cloud-init file is the source of truth for the generated systemd units and Caddy configuration.

## Quick start

1. Replace every placeholder value in `cloud-init.yml`.
2. Replace the Litestream SHA256 placeholders for the architecture you will deploy.
3. Point your proxied Cloudflare DNS record to the VPS.
4. Set Cloudflare SSL/TLS mode to Full (strict).
5. Create an Ubuntu LTS VPS and paste `cloud-init.yml` as user data.
6. Connect as the `deploy` user.
7. Verify the services.

```bash
ssh deploy@YOUR_SERVER_IP
sudo ufw status verbose
sudo systemctl status app
sudo systemctl status caddy
sudo systemctl status litestream
curl -I https://app.example.com/health
```

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

## License

MIT
