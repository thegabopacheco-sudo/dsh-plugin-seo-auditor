# How dsh-plugin-seo-auditor works

Auditoría SEO para DeepSeek Harness: title, meta, headings, imágenes sin alt, enlaces rotos, robots.txt y sitemap de cualquier sitio http(s) con lista blanca de hosts.

## Architecture

```
DSH ──MCP stdio──► server.mjs (single-file bundle)
                    └─ local plugin logic
```

## Safety

- Read by default; actions require `confirm:true`.
- `read-only` mode via environment variable.
- Allowlists where applicable.
- Audit at `<DSH_HOME>\cache\seo-auditor\audit.jsonl`.
- Action rate limit.

## Validation

End-to-end tests with the official MCP client (`@modelcontextprotocol/client@2.2.0`)
and the packaged artifact (`npm pack` → `postinstall` → deployed server).
