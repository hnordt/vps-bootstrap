# Cloudflare origin setup

Use `cloud-init.yml` when the domain is proxied through Cloudflare and you do not want the origin exposed directly on public HTTPS.

## Origin traffic model

```txt
browser -> Cloudflare edge -> 443 -> VPS -> Caddy -> 127.0.0.1:3000 -> Node app
```

The VPS firewall allows SSH and allows HTTPS only from Cloudflare IP ranges.

## Required Cloudflare settings

1. Create an `A` record for your app domain pointing to the VPS IP.
2. Enable proxying for that record.
3. Set SSL/TLS mode to `Full (strict)`.
4. Create an Origin Certificate in Cloudflare.
5. Paste the certificate and key into the cloud-init placeholders.

## Placeholders

```txt
__SSH_PUBLIC_KEY__
__DOMAIN__
__CLOUDFLARE_ORIGIN_CERT_PEM__
__CLOUDFLARE_ORIGIN_KEY_PEM__
__S3_ENDPOINT__
__S3_REGION__
__S3_BUCKET__
__S3_ACCESS_KEY_ID__
__S3_SECRET_ACCESS_KEY__
```

## Notes

Cloudflare Origin Certificates are meant to secure the connection between Cloudflare and the origin server. They are compatible with Full (strict) mode, but they are not browser-trusted certificates if someone bypasses Cloudflare and connects directly to the origin.

The template keeps port 80 closed. Cloudflare can handle HTTP to HTTPS redirects at the edge.

The template syncs Cloudflare IP ranges into UFW at boot and then weekly through a systemd timer.

## Important caveats

Secrets are present in cloud-init user data. This is simple, but not ideal for high-security environments. For stricter operations, boot without secrets and upload the Origin Certificate key and Litestream credentials after the server is created.

The app must read the real client IP from `CF-Connecting-IP`, because the direct peer address will be a Cloudflare address.

Before trusting backups, test a full restore on a scratch VPS.
