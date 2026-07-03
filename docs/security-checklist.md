# Security checklist

## SSH

- [ ] Root login is disabled.
- [ ] Password login is disabled.
- [ ] Only the `deploy` user can SSH.
- [ ] Your SSH private key is protected with a passphrase.
- [ ] Optional: SSH is restricted to known IP addresses.

## Firewall

- [ ] UFW is enabled.
- [ ] Default incoming policy is deny.
- [ ] Default outgoing policy is allow.
- [ ] Only `22/tcp` and `443/tcp` are open.
- [ ] Cloudflare-origin deployments allow `443/tcp` only from Cloudflare IP ranges.
- [ ] Cloudflare IP sync fetches and validates the new list before deleting existing allow rules.

## Application boundary

- [ ] The Node app binds to `127.0.0.1`, not `0.0.0.0`.
- [ ] Caddy is the only public HTTP entrypoint.
- [ ] The database is stored under `/var/lib/app`.
- [ ] Application code is stored outside writable application state.
- [ ] The app does not run as root.
- [ ] The app user cannot overwrite deployed application code.
- [ ] The app user cannot read Litestream backup credentials.

## Backups

- [ ] Litestream is running.
- [ ] Litestream runs as a dedicated `litestream` user.
- [ ] Object storage credentials are not committed.
- [ ] Production object storage credentials are not placed in cloud-init user data when avoidable.
- [ ] Object storage credentials are scoped to the backup bucket or path only.
- [ ] Bucket versioning is enabled.
- [ ] Object lock is enabled if destructive backup deletion must be prevented.
- [ ] Restore has been tested.
- [ ] Restore documentation is accurate for the current bucket and endpoint.

## Supply chain

- [ ] Litestream version is pinned.
- [ ] Litestream release archives are verified with SHA256 before extraction.
- [ ] SHA256 placeholders are replaced before deployment.

## Operations

- [ ] Security updates are enabled.
- [ ] Disk usage is monitored.
- [ ] `/health` is monitored.
- [ ] Logs are retained but bounded.
