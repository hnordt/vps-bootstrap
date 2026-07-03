# Litestream install snippet

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
