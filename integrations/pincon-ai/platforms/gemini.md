# Gemini integration

PinCon does not maintain a separate Gemini backend. Gemini-compatible integrations use the same PinCon data plane as ChatGPT.

## Preferred path: Remote MCP

Use this server when the Gemini API or Gemini surface being used supports Remote MCP:

```text
https://pincon-ai.vercel.app/api/mcp
```

Authentication is OAuth 2.1 with PKCE and scope `pincon:read`. The OAuth connection stores the user's class binding, so tools can omit `classKey` for normal user connections.

Expected tools:

- `get_today`
- `get_timetable`
- `get_meal`
- `get_assignments`
- `get_notices`
- `get_school_events`
- `get_upcoming`

## Compatibility fallback: OpenAPI / function calling

When a Gemini environment does not expose Remote MCP but can use HTTP/function tools, use:

```text
https://pincon-ai.vercel.app/openapi.json
```

The OpenAPI fallback points to the same read-only REST data and uses the same Bearer authentication model. It exists only as a platform adapter; PinCon business logic must remain in the shared gateway.

## Recommended Gemini system instruction

Use the companion `gemini-system-instruction.md` when building a Gemini API client around PinCon. It mirrors the intent of the PinCon Skills without copying OpenAI-specific plugin packaging.

## Security

- Never embed `PINCON_API_KEY` in a browser, Android app, Gem, or shared prompt.
- Public user connections use OAuth access tokens.
- Treat school-life facts as tool-derived data. Do not infer missing timetable, meal, assignment, notice, or event information.
- Keep PinCon write operations disabled until a separate approval and audit model is implemented.
