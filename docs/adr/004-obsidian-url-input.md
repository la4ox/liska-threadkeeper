# ADR-004: Use a Full URL with a Loopback-Only Obsidian API Boundary

## Status

Accepted; amended for Liska on 2026-08-12.

## Context

The original port-only setting could not represent both HTTP and HTTPS Local
REST API endpoints. The configured API key is a bearer credential, so a synced
or corrupted setting must not be able to redirect authenticated requests to a
LAN or Internet host.

## Decision

- Store the endpoint as `SyncSettings.obsidianUrl`, with
  `http://127.0.0.1:27123` as the default.
- Accept only `http` or `https` URLs whose hostname is exactly `127.0.0.1`.
- Reject embedded credentials and explicit ports outside `1024`–`65535`.
- Normalize accepted input to its origin, discarding paths, queries, fragments,
  and trailing slashes.
- Revalidate the stored value in the background process and construct the
  authenticated client from the normalized origin.
- Grant manifest and extension-page network access to HTTP and HTTPS loopback,
  not to LAN API hosts.
- Continue reading the legacy `obsidianPort` setting as
  `http://127.0.0.1:<port>` so existing installations migrate without losing
  their endpoint.

Schema normalization deliberately preserves a stored string until it reaches
the privileged background boundary. The background validation is therefore the
authoritative check before the bearer token is attached.

## Consequences

- Users can choose HTTP or HTTPS and a custom local port through one field.
- `localhost`, IPv6 loopback, LAN addresses, and remote hosts are intentionally
  rejected; users must configure the Local REST API at `127.0.0.1`.
- HTTPS with the plugin's self-signed certificate may require trusting that
  certificate at the operating-system level.
- The API key remains bound to the same explicit loopback origin permitted by
  the extension manifest.
