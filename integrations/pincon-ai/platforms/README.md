# PinCon AI platform adapters

PinCon keeps one platform-neutral data plane and puts thin platform packaging around it.

## Core

- Remote MCP: `https://pincon-ai.vercel.app/api/mcp`
- OAuth protected-resource metadata: `https://pincon-ai.vercel.app/.well-known/oauth-protected-resource`
- OAuth authorization-server metadata: `https://pincon-ai.vercel.app/.well-known/oauth-authorization-server`
- OpenAPI fallback: `https://pincon-ai.vercel.app/openapi.json`
- OAuth scope: `pincon:read`

The MCP server is the source of truth for AI tools. Do not fork separate ChatGPT and Gemini data implementations.

## Platform policy

### ChatGPT / Codex

Use the PinCon Plugin in `plugins/pincon/`. The Plugin packages the PinCon MCP app with reusable Skills such as Daily Brief and Weekly Planner.

### Gemini

Prefer Remote MCP whenever the Gemini surface/API being used supports remote MCP. Use the same MCP endpoint and OAuth server. When a Gemini surface only supports function calling/OpenAPI-style tools, use `openapi.json` as the compatibility fallback instead of creating a second PinCon backend.

### Other AI clients

1. Prefer Remote MCP + OAuth.
2. Fall back to OpenAPI + Bearer authentication when MCP is unavailable.
3. Never expose `PINCON_API_KEY` to end users. Public user connections must use OAuth.

This keeps authentication, class scoping, data sanitization, and PinCon business rules in one server rather than duplicating them per AI vendor.
