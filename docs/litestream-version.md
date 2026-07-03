# Litestream version

Litestream 0.5 uses a single `replica` field in the configuration file.

The templates use the v0.5 configuration shape and install the latest Litestream release dynamically from GitHub release assets.

At the time this was reviewed, the latest GitHub release was `v0.5.13`.

If you want fully deterministic provisioning, pin a specific Litestream release and checksum in your own fork.
