# auto-geo-mcp

MCP server that wraps an `auto-geo` publish endpoint as a tool. Any MCP-aware AI client (Claude Desktop, Claude Code, Cursor, your own agent) can register this server and publish GEO resource pages by calling one tool.

## Install

```bash
npm i -g auto-geo-mcp
# or run on demand:
npx -y auto-geo-mcp
```

## Configuration

Two environment variables, set in the MCP client's config:

- `AUTO_GEO_PUBLISH_URL` — full URL to your deployed `/api/resources/publish` endpoint.
- `AUTO_GEO_PUBLISH_TOKEN` — bearer token matching the `GEO_PUBLISH_TOKEN` on the server.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "auto-geo": {
      "command": "npx",
      "args": ["-y", "auto-geo-mcp"],
      "env": {
        "AUTO_GEO_PUBLISH_URL": "https://yoursite.com/api/resources/publish",
        "AUTO_GEO_PUBLISH_TOKEN": "..."
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add auto-geo \
  --command "npx -y auto-geo-mcp" \
  --env AUTO_GEO_PUBLISH_URL=https://yoursite.com/api/resources/publish \
  --env AUTO_GEO_PUBLISH_TOKEN=...
```

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "auto-geo": {
      "command": "npx",
      "args": ["-y", "auto-geo-mcp"],
      "env": {
        "AUTO_GEO_PUBLISH_URL": "https://yoursite.com/api/resources/publish",
        "AUTO_GEO_PUBLISH_TOKEN": "..."
      }
    }
  }
}
```

## Tools

The server exposes one tool: `publish_resource`. Its input schema mirrors the publish API contract. See the parent repo's `core/schema.ts` for the canonical Zod schema and `docs/sop.md` for the constraint rationale.

Validation runs server-side against the publish endpoint's Zod schema. Hard errors come back as HTTP 400 with an `issues[]` array; soft warnings come back as `warnings[]` on a 200. The MCP server is a typed forwarder, not a re-validator.

## Local development

```bash
pnpm install
pnpm dev    # tsx server.ts (stdio mode; pipe to an MCP client)
```

For debugging without a client, use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```
