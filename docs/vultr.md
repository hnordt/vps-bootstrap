# Vultr setup

## Create the server

1. Choose an Ubuntu LTS image.
2. Choose a region close to your users.
3. Add your SSH key in Vultr.
4. Paste the cloud-init template into the user data field.
5. Create the instance.

## DNS

Create an `A` record pointing your domain to the VPS IPv4 address.

Example:

```txt
app.example.com -> YOUR_SERVER_IP
```

Caddy needs the domain to resolve to the server before it can issue a TLS certificate.

## First connection

```bash
ssh deploy@YOUR_SERVER_IP
```

## Verify boot

```bash
cloud-init status --long
sudo ufw status verbose
sudo systemctl status app
sudo systemctl status caddy
sudo systemctl status litestream
```

## Certificate notes

If certificate issuance fails, confirm that DNS already points to the server and that your provider firewall allows HTTPS traffic.
