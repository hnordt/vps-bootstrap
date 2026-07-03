# VPS Bootstrap

Cloud-init templates and setup files for running small production-oriented Node.js servers on VPS providers.

The default template targets Ubuntu LTS and includes:

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

## Repository structure

```txt
cloud-init/
  ubuntu-node-caddy-litestream.yml
systemd/
  app.service
  litestream.service
caddy/
  Caddyfile
docs/
  vultr.md
  security-checklist.md
  litestream-restore.md
```

## Quick start

1. Copy `cloud-init/ubuntu-node-caddy-litestream.yml`.
2. Replace every placeholder value.
3. Point your domain to the VPS.
4. Create an Ubuntu LTS VPS and paste the file as user data.
5. Connect as the `deploy` user.
6. Verify the services.

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

For production, prefer uploading `/etc/litestream/env` after the server boots instead of placing production credentials directly in cloud-init user data.

## License

MIT
