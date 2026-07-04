# VPS Bootstrap

Bootstrap a Node.js VPS with a reusable cloud-init template and optional
provider automation.

The goal of this bootstrap is to stay provider-agnostic, so the cloud-init
template can be used with any VPS provider that accepts cloud-init user data.

Currently, the repository includes an automated deployment script for Vultr.
If you run `npm run vultr`, the script will ask you a few questions and create
a Vultr instance.

If you do not use Vultr, you can still copy `src/cloud-config.yaml`, replace the
placeholders manually, and create the VPS instance in your preferred provider's
console.

More automated deployment scripts for other providers may be added in the
future.

## What It Creates

The generated cloud-init user data targets Ubuntu 26.04 LTS and provisions a VPS with:

- key-only SSH access for a `deploy` user
- a locked root account
- unattended package upgrades
- UFW firewall rules for SSH and Cloudflare-proxied HTTP/HTTPS
- fail2ban for SSH protection
- Node.js from the Ubuntu package repositories
- a simple Node.js hello-world app bound to `127.0.0.1:3000`
- Caddy as the public reverse proxy, configured with baseline HTTP security headers
- Litestream installed from its Debian package

The resulting app path is:

```txt
browser -> Cloudflare -> 80/443 -> Caddy -> 127.0.0.1:3000 -> Node hello-world app
```

## Files

- `src/cloud-config.yaml`: cloud-init template. It contains placeholders for generated values.
- `src/vultr.ts`: interactive Vultr deployment script. It renders the template and sends it as instance user data.
- `package.json`: exposes the `npm run vultr` command.

Template placeholders:

- `${{ __SSH_AUTHORIZED_KEYS__ }}`: replaced with a JSON-style YAML array of SSH public keys.
- `${{ __PUBLIC_DOMAIN__ }}`: replaced with the domain Caddy should serve.

## Manual Provider Setup

To use the bootstrap template without the Vultr automation:

1. Copy the contents of `src/cloud-config.yaml`.
2. Replace `${{ __SSH_AUTHORIZED_KEYS__ }}` with a YAML array of SSH public keys.
3. Replace `${{ __PUBLIC_DOMAIN__ }}` with the domain Caddy should serve.
4. Paste the rendered cloud-init config into your provider's user-data or
   cloud-init field when creating the instance.

Make sure the selected server image supports cloud-init. The template targets
Ubuntu 26.04 LTS, but should probably work on most Debian-based distributions.

## Prerequisites

- Node.js with support for `--experimental-strip-types` available in `node`.
- npm.
- A Vultr API key with permission to create instances.
- One or more SSH public keys, such as the contents of `~/.ssh/id_ed25519.pub`.
- A domain name you can proxy through Cloudflare and point at the new server.

Install dependencies:

```bash
npm install
```

## Deploy To Vultr

Run the interactive deployment script:

```bash
npm run vultr
```

The script will ask for:

1. SSH authorized keys, comma-separated.
2. The public domain Caddy should serve.
3. Your Vultr API key.
4. A Vultr region.
5. A Vultr plan available in that region.

After you confirm the prompts, the script:

1. Reads `src/cloud-config.yaml`.
2. Replaces the SSH key and domain placeholders.
3. Base64-encodes the rendered cloud-init payload.
4. Creates a Vultr instance using the rendered payload as user data.
5. Prints a Vultr Console URL for the new instance.

The rendered cloud-config is sent to Vultr; it is not written to a local file.

## DNS

This bootstrap assumes Cloudflare is the external HTTP/HTTPS proxy.

After the instance is created:

1. Open the Vultr Console URL printed by the script.
2. Copy the instance public IPv4 address.
3. In Cloudflare DNS, create an `A` record for your domain pointing to that
   address.
4. Set the DNS record proxy status to **Proxied**.
5. Wait for DNS to propagate.

During provisioning, cloud-init fetches Cloudflare's current IPv4 and IPv6
ranges from `https://www.cloudflare.com/ips-v4` and
`https://www.cloudflare.com/ips-v6`, then creates UFW allow rules for `80/tcp`
and `443/tcp` from those ranges only. Direct origin HTTP/HTTPS requests from
non-Cloudflare IP addresses are blocked by UFW.

If the Cloudflare IP range fetch fails, the UFW setup command fails before
running `ufw --force enable`. This keeps the origin from being opened with stale
or incomplete HTTP/HTTPS allow rules.

Caddy is configured for the domain you entered and forwards Cloudflare's
`CF-Connecting-IP` value as `X-Forwarded-For`, so the Node.js app can receive
the original visitor IP through the forwarded header.

For Cloudflare SSL/TLS mode, use **Full** or **Full (strict)**. Use **Full** if
the origin certificate is not yet valid for strict verification. Use
**Full (strict)** after the origin has a certificate Cloudflare can validate.

SSH remains direct. Use the server public IP address, or an unproxied DNS
record, for `ssh deploy@...`. Cloudflare's normal proxied DNS records do not
proxy SSH.

## HTTP Security Headers

This repository's Caddy setup adds baseline HTTP security headers to every
response served by the public site block:

```txt
Strict-Transport-Security: max-age=31536000
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

These headers define the following browser-side defaults:

- HTTPS is required for future requests to the configured domain.
- The site cannot be embedded in a frame.
- Browsers should not MIME-sniff responses away from their declared content type.
- Cross-origin referrers expose only the origin instead of the full URL.

The HSTS header intentionally does not include `includeSubDomains` or `preload`.
Add `includeSubDomains` only if every subdomain is HTTPS-ready. Add `preload`
only if the root domain and all subdomains are permanently HTTPS-only and you
intend to submit the domain to the browser preload list.

## Verify The Server

SSH into the server as `deploy`:

```bash
ssh deploy@YOUR_SERVER_IP
```

Check cloud-init and services:

```bash
cloud-init status --long
sudo ufw status verbose
sudo systemctl status hello-node
sudo systemctl status caddy
sudo systemctl status fail2ban
```

Check the app:

```bash
curl -i http://127.0.0.1:3000
curl -I https://YOUR_DOMAIN
```

The response body from the app should be:

```txt
Hello world
```

## Customization

To change what the server provisions, edit `src/cloud-config.yaml`.

Common changes:

- Replace `/opt/hello/server.js` with your application bootstrap.
- Replace `hello-node.service` with your production systemd service.
- Change `/opt/hello/Caddyfile` for routing, headers, or additional domains.
- Adjust UFW rules if the server should only accept traffic from a trusted edge.
- Configure Litestream before relying on it for backups.

To change Vultr-specific defaults, edit `src/vultr.ts`.

Common changes:

- `OS.id`: the Vultr operating system image.
- `OS.minRam`: the minimum RAM used when filtering plans.
- instance creation options in the `/v2/instances` request body.

## Security Notes

Do not commit real credentials.

The Vultr API key is entered interactively and is not stored by this repository.
The SSH public keys and domain are embedded in the cloud-init user data sent to
Vultr.

Cloud-init user data may be retained by the VPS provider and may be readable
from inside the instance by privileged users. Avoid putting long-lived
production secrets directly in `src/cloud-config.yaml`.

Before using this as a production baseline, review:

- whether the selected Ubuntu image in `src/vultr.ts` is the one you want
- whether your provisioning environment can reach Cloudflare's IP range endpoints
- whether the app service should run your real app instead of the hello-world server
- whether the default security headers match your embedding, referrer, and subdomain policy
- whether Litestream needs a real configuration and backup credentials
- whether your DNS and HTTPS setup matches your edge provider
