import { firebaseAuth } from "../lib/firebase.mjs";
import { corsHeaders, requireFirebaseUser } from "../lib/class-accounts.mjs";
import { jsonBody, sendJson } from "../lib/request.mjs";

const MAX_CHARS = 16;
const HAN_RE = /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]$/u;

function cleanText(value, max = 500) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanChars(value) {
  const raw = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    for (const char of Array.from(String(item || ""))) {
      if (!HAN_RE.test(char) || seen.has(char)) continue;
      seen.add(char);
      out.push(char);
      if (out.length >= MAX_CHARS) return out;
    }
  }
  return out;
}

function stripFence(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function normalizeParts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((row) => {
    if (Array.isArray(row)) return [cleanText(row[0], 8), cleanText(row[1], 40), cleanText(row[2], 80)];
    return [cleanText(row?.char, 8), cleanText(row?.label, 40), cleanText(row?.note, 80)];
  }).filter((row) => row[0]);
}

function normalizeUsage(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((row) => {
    if (Array.isArray(row)) return [cleanText(row[0], 16), cleanText(row[1], 40), cleanText(row[2], 100)];
    return [cleanText(row?.word, 16), cleanText(row?.reading, 40), cleanText(row?.note, 100)];
  }).filter((row) => row[0]);
}

function normalizeEntry(input, requested) {
  const char = cleanText(input?.char, 4);
  if (!requested.includes(char)) return null;
  const origin = cleanText(input?.origin, 900);
  return {
    char,
    hun: cleanText(input?.hun, 30),
    eum: cleanText(input?.eum, 20),
    parts: normalizeParts(input?.parts),
    structure: cleanText(input?.structure, 700),
    origin,
    memory: cleanText(input?.memory, 500),
    usage: normalizeUsage(input?.usage),
    originExtra: {
      type: cleanText(input?.originExtra?.type, 50),
      key: cleanText(input?.originExtra?.key, 80),
      era: cleanText(input?.originExtra?.era, 80),
      origin: cleanText(input?.originExtra?.origin || origin, 900),
      deep: cleanText(input?.originExtra?.deep, 1200),
      caution: cleanText(input?.originExtra?.caution, 700),
    },
  };
}

function promptFor(chars) {
  return `너는 한국 고등학교 한문 학습용 한자 데이터 편집자다. 다음 한자의 학습 초안을 만든다: ${chars.join(" ")}.

반드시 JSON만 출력한다. 코드블록, 설명 문장, 마크다운을 붙이지 않는다.
형식:
{"entries":[{"char":"學","hun":"배울","eum":"학","parts":[["구성요소","한국어 이름","역할/위치"]],"structure":"현재 자형을 학습하기 위한 구조 설명","origin":"실제 자원에 근거한 짧은 유래 설명","memory":"실제 자원과 구분되는 암기용 기억법","usage":[["學校","학교","배울 학 · 학교 교"]],"originExtra":{"type":"상형자/회의자/형성자 등, 확실하지 않으면 계열이라고 표현","key":"핵심 구성","era":"확인되는 자형 시대를 보수적으로 표현","origin":"자원 설명","deep":"뜻의 확장과 자형을 자세히 설명","caution":"통설과 암기 이야기를 구별하는 주의"}}]}

규칙:
1. 한국에서 통용되는 훈과 음을 쓴다. 두음법칙이 걸리는 음은 해당 글자의 대표 음을 쓴다.
2. usage는 실제로 자주 쓰는 고등학교 수준 한자어 3개를 우선한다.
3. 실제 문자학적 유래와 암기용 이야기를 섞지 않는다. 불확실하거나 학설이 갈리는 자원은 단정하지 않는다.
4. parts는 현재 자형을 학습하기 좋은 덩어리로 1~4개 제시하되, 그 분해가 곧 역사적 자원이라고 거짓말하지 않는다.
5. 획수는 출력하지 않는다. 획수는 클라이언트의 Hanzi Writer 데이터가 결정한다.
6. 간체자가 아니라 입력된 글자 자체를 기준으로 설명한다.
7. 요청된 각 글자를 정확히 한 번씩 반환한다.`;
}

async function askGemini(chars) {
  const key = String(process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw Object.assign(new Error("ai-not-configured"), { status: 503 });
  const model = String(process.env.GEMINI_MODEL || "gemini-3.6-flash").trim();
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ model, input: promptFor(chars) }),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const error = new Error(`gemini-${response.status}`);
    error.status = 502;
    throw error;
  }
  const output = body?.output_text || body?.outputText || body?.text || "";
  let parsed;
  try { parsed = JSON.parse(stripFence(output)); }
  catch {
    const error = new Error("ai-invalid-json");
    error.status = 502;
    throw error;
  }
  const entries = (Array.isArray(parsed?.entries) ? parsed.entries : [])
    .map((item) => normalizeEntry(item, chars))
    .filter(Boolean);
  const byChar = new Map(entries.map((item) => [item.char, item]));
  return chars.map((char) => byChar.get(char)).filter(Boolean);
}

export default async function hanjaDraft(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method-not-allowed" }, headers);

  try {
    const token = await requireFirebaseUser(req);
    const provider = String(token?.firebase?.sign_in_provider || "");
    if (provider === "anonymous") {
      return sendJson(res, 403, { ok: false, error: "account-link-required" }, headers);
    }
    const body = await jsonBody(req);
    const chars = cleanChars(body?.chars ?? body?.char);
    if (!chars.length) return sendJson(res, 400, { ok: false, error: "hanja-required" }, headers);

    const entries = await askGemini(chars);
    return sendJson(res, 200, { ok: true, entries }, headers);
  } catch (error) {
    const status = Number(error?.status || 500);
    const code = status >= 500 ? String(error?.message || "hanja-draft-failed") : String(error?.message || "hanja-draft-failed");
    return sendJson(res, status, { ok: false, error: code }, headers);
  }
}
