# VPS Bootstrap

Cloud-init templates and setup files for running small production-oriented Node.js servers on VPS providers.

The default templates target Ubuntu LTS and include:

- Node.js
- Caddy as the public HTTPS reverse proxy
- systemd services for the application and Litestream
- SQLite with WAL mode
- UFW firewall rules
- fail2ban
- unattended security upgrades
- key-only SSH access

## Goal

This repository provides a predictable baseline for a small VPS.

```txt
internet -> 443 -> Caddy -> 127.0.0.1:3000 -> Node app -> SQLite
```

The application should listen on `127.0.0.1`. Caddy should be the only public HTTP entrypoint.

## Templates

```txt
cloud-init/ubuntu-node-caddy-litestream.yml
```

Generic template. Caddy obtains public TLS certificates directly.

```txt
cloud-init/ubuntu-node-caddy-cloudflare-litestream.yml
```

Cloudflare-origin template. Caddy uses a Cloudflare Origin Certificate, Cloudflare should be set to Full (strict), and UFW allows port 443 only from Cloudflare IP ranges.

## Repository structure

```txt
cloud-init/
  ubuntu-node-caddy-litestream.yml
  ubuntu-node-caddy-cloudflare-litestream.yml
systemd/
  app.service
  litestream.service
caddy/
  Caddyfile
docs/
  vultr.md
  cloudflare-origin.md
  security-checklist.md
  litestream-restore.md
  litestream-version.md
```

## Quick start

1. Choose one template from `cloud-init/`.
2. Replace every placeholder value.
3. Replace the Litestream SHA256 placeholders for the architecture you will deploy.
4. Point your domain to the VPS.
5. Create an Ubuntu LTS VPS and paste the file as user data.
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
