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

## Application boundary

- [ ] The Node app binds to `127.0.0.1`, not `0.0.0.0`.
- [ ] Caddy is the only public HTTP entrypoint.
- [ ] The database is stored under `/var/lib/app`.
- [ ] The app does not run as root.

## Backups

- [ ] Litestream is running.
- [ ] Object storage credentials are not committed.
- [ ] Restore has been tested.
- [ ] Restore documentation is accurate for the current bucket and endpoint.

## Operations

- [ ] Security updates are enabled.
- [ ] Disk usage is monitored.
- [ ] `/health` is monitored.
- [ ] Logs are retained but bounded.
