# Litestream version

Litestream 0.5 uses a single `replica` field in the configuration file.

The templates use the v0.5 configuration shape and pin the Litestream release URL to `v0.5.13`.

The templates also require architecture-specific SHA256 placeholders to be replaced before deployment:

```txt
__LITESTREAM_SHA256_AMD64__
__LITESTREAM_SHA256_ARM64__
```

This makes provisioning deterministic and prevents running a dynamically selected GitHub release as `root` without integrity verification.

When upgrading Litestream:

1. Choose the new release version.
2. Update `LITESTREAM_VERSION` in both cloud-init templates.
3. Download the release artifacts for each target architecture.
4. Compute the SHA256 checksum for each artifact.
5. Replace the checksum placeholders in the deployed template.
6. Test restore and replication on a disposable VPS before using the new version in production.
