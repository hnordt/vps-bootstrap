# Litestream restore

Backups are only useful if restore is tested.

## Stop services

```bash
sudo systemctl stop app
sudo systemctl stop litestream
```

## Move the current database away

```bash
sudo mv /var/lib/app/app.sqlite /var/lib/app/app.sqlite.bak
sudo rm -f /var/lib/app/app.sqlite-wal /var/lib/app/app.sqlite-shm
```

## Restore from object storage

```bash
sudo env \
  AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID \
  AWS_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY \
  litestream restore \
    -config /etc/litestream.yml \
    /var/lib/app/app.sqlite
```

## Fix ownership

```bash
sudo chown app:app /var/lib/app/app.sqlite*
```

## Start services

```bash
sudo systemctl start litestream
sudo systemctl start app
```

## Verify

```bash
sudo systemctl status litestream
sudo systemctl status app
curl -I https://app.example.com/health
```
