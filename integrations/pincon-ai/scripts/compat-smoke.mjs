const origin = String(process.env.PINCON_ORIGIN || "https://pincon-ai.vercel.app").replace(/\/$/, "");
const resource = String(process.env.PINCON_RESOURCE || "https://pincon-ai.vercel.app/api/mcp").trim();
const apiKey = String(process.env.PINCON_API_KEY || "").trim();
const classKey = String(process.env.PINCON_CLASS_KEY || "1-8").trim();
const protocolVersion = String(process.env.MCP_PROTOCOL_VERSION || "2025-06-18").trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${url} returned non-JSON (${response.status}): ${text.slice(0, 180)}`);
  }
  return { response, body };
}

async function discoveryChecks() {
  const protectedResource = await json(`${origin}/.well-known/oauth-protected-resource`);
  assert(protectedResource.response.ok, "Protected-resource metadata is not reachable.");
  assert(protectedResource.body.resource === resource, "Protected-resource MCP URL does not match PINCON_RESOURCE.");
  assert(protectedResource.body.scopes_supported?.includes("pincon:read"), "pincon:read scope is missing.");

  const authorizationServer = await json(`${origin}/.well-known/oauth-authorization-server`);
  assert(authorizationServer.response.ok, "Authorization-server metadata is not reachable.");
  assert(authorizationServer.body.code_challenge_methods_supported?.includes("S256"), "OAuth PKCE S256 is missing.");
  assert(authorizationServer.body.grant_types_supported?.includes("authorization_code"), "authorization_code grant is missing.");

  const spec = await json(`${origin}/openapi.json`);
  assert(spec.response.ok, "OpenAPI fallback is not reachable.");
  assert(spec.body.openapi === "3.1.0", "OpenAPI fallback is not OpenAPI 3.1.");
  assert(spec.body.paths?.["/api/v1/today"], "OpenAPI fallback is missing getToday.");

  const unauthenticated = await fetch(`${origin}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "auth-check",
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: "pincon-compat-smoke", version: "0.1.0" },
      },
    }),
  });
  assert(unauthenticated.status === 401, `Unauthenticated MCP should return 401, received ${unauthenticated.status}.`);
  const challenge = unauthenticated.headers.get("www-authenticate") || "";
  assert(challenge.includes("oauth-protected-resource"), "MCP 401 response does not advertise OAuth protected-resource metadata.");
}

async function authenticatedChecks() {
  if (!apiKey) {
    console.log("SKIP authenticated checks: PINCON_API_KEY is not set.");
    return;
  }

  const headers = { authorization: `Bearer ${apiKey}` };
  const today = await json(`${origin}/api/v1/today?classKey=${encodeURIComponent(classKey)}`, { headers });
  assert(today.response.ok && today.body?.ok === true, "Authenticated REST read failed.");

  const init = await json(`${origin}/api/mcp`, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: "pincon-compat-smoke", version: "0.1.0" },
      },
    }),
  });
  assert(init.response.ok, `Authenticated MCP initialize failed with ${init.response.status}.`);
  assert(init.body?.result?.serverInfo?.name === "pincon", "MCP initialize did not identify the PinCon server.");
}

await discoveryChecks();
await authenticatedChecks();
console.log(`PASS PinCon AI compatibility checks: ${origin}`);
