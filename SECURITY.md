# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in `auto-geo`, please **do not open a public issue**. Instead, email the maintainers at:

**security@shadow.inc**

Include in your report:

- A description of the vulnerability and its potential impact.
- A minimal reproduction (code, payloads, or curl commands).
- The version of `auto-geo` affected.
- Your assessment of severity.
- Whether you intend to publicly disclose; we coordinate disclosure timelines on request.

We will acknowledge receipt within **2 business days** and aim to provide a fix or mitigation within **30 days** for high-severity reports.

## Scope

### In scope

- The publish API (`adapters/http/*`) — authentication bypass, injection, request smuggling.
- Schema validation (`core/schema.ts`) — payloads that crash the validator or bypass constraints.
- JSON-LD generation (`core/jsonld.ts`) — script breakout, content injection.
- Inline renderer (`components/react/inline.tsx`) — XSS, prototype pollution.
- Storage adapters — credential leakage, query injection.
- MCP server (`mcp/server.ts`) — authentication bypass, command injection.

### Out of scope

- Issues with example apps in `examples/` that don't carry over to the library code.
- Misconfigurations in user-controlled environment (e.g., committing `GEO_PUBLISH_TOKEN` to source).
- Denial-of-service via deeply nested or oversized payloads — payload size limits are the responsibility of the host HTTP layer (e.g., Next.js / Vercel route config).
- Vulnerabilities in transitive dependencies that have not been published as CVEs — file those upstream.

## Hardening recommendations

If you operate an `auto-geo` deployment:

- **Use a long, random `GEO_PUBLISH_TOKEN`** — `openssl rand -hex 32` minimum. Rotate quarterly.
- **Set a request body size limit** on the publish endpoint. The schema rejects oversized payloads, but the request body is parsed before validation. A reasonable limit is 1MB.
- **Apply rate limits** on the publish endpoint. The schema is permissive on slug uniqueness (re-publishes overwrite), so an attacker with a valid token could overwrite content rapidly.
- **Never expose the publish endpoint to unauthenticated clients.** It is server-to-server by design.
- **Audit reserved slugs** to ensure no statically routed pages can be overwritten. Pass them via the `reservedSlugs` option.
- **For Supabase**, ensure the service-role key never leaks to the client; only the server should ever hold it.
- **For MCP**, the `AUTO_GEO_PUBLISH_TOKEN` lives in the MCP client's config. Treat the client config as a secret.

## Acknowledgements

We credit researchers who report valid vulnerabilities in this file (with permission) and in the release notes for the version that fixes the issue.
