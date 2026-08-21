const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
const pinconBearerToken = String(process.env.PINCON_BEARER_TOKEN || "").trim();
const model = String(process.env.GEMINI_MODEL || "gemini-3.6-flash").trim();
const prompt = process.argv.slice(2).join(" ").trim()
  || String(process.env.GEMINI_PROMPT || "오늘 뭐 있어? PinCon을 사용해서 한국어로 간단히 정리해줘.").trim();

if (!geminiApiKey) {
  throw new Error("GEMINI_API_KEY is required.");
}
if (!pinconBearerToken) {
  throw new Error("PINCON_BEARER_TOKEN is required. Prefer a user OAuth access token; use PINCON_API_KEY only for private development testing.");
}

const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-goog-api-key": geminiApiKey,
  },
  body: JSON.stringify({
    model,
    input: prompt,
    tools: [
      {
        type: "mcp_server",
        name: "pincon",
        url: "https://pincon-ai.vercel.app/api/mcp",
        headers: {
          Authorization: `Bearer ${pinconBearerToken}`,
        },
        allowed_tools: [
          "get_today",
          "get_timetable",
          "get_meal",
          "get_assignments",
          "get_notices",
          "get_school_events",
          "get_upcoming",
        ],
      },
    ],
  }),
});

const text = await response.text();
let body;
try {
  body = text ? JSON.parse(text) : null;
} catch {
  throw new Error(`Gemini returned non-JSON (${response.status}): ${text.slice(0, 500)}`);
}

if (!response.ok) {
  throw new Error(`Gemini Interactions API failed (${response.status}): ${JSON.stringify(body)}`);
}

console.log(body?.output_text || JSON.stringify(body, null, 2));
