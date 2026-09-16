package com.tether.focus

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object GeminiTaskPlanner {
    const val DEFAULT_MODEL = "gemini-3.1-flash-lite"

    suspend fun createPlan(
        apiKey: String,
        model: String,
        goal: String,
        riskBand: DriftBand,
        predictedFirstDriftMinute: Int?
    ): Result<AtomicPlan> = withContext(Dispatchers.IO) {
        runCatching {
            require(apiKey.isNotBlank()) { "API 키가 비어 있음" }
            require(goal.isNotBlank()) { "목표가 비어 있음" }

            val prompt = buildString {
                appendLine("공부 목표: $goal")
                appendLine("현재 집중 흔들림 위험: ${riskBand.label}")
                predictedFirstDriftMinute?.let { appendLine("과거 첫 흔들림 중앙값: 약 ${it}분") }
                appendLine("이 목표를 지금 바로 실행할 수 있는 작은 행동들로 컴파일해라.")
            }

            val raw = callGemini(
                apiKey = apiKey,
                model = model.ifBlank { DEFAULT_MODEL },
                systemInstruction = PLAN_SYSTEM,
                userText = prompt,
                schema = planSchema(),
                maxOutputTokens = 1400
            )
            parsePlan(goal, raw)
        }
    }

    suspend fun createRescueStep(
        apiKey: String,
        model: String,
        currentAction: String,
        reason: String = "막힘"
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            require(apiKey.isNotBlank()) { "API 키가 비어 있음" }
            require(currentAction.isNotBlank()) { "현재 행동이 비어 있음" }

            val raw = callGemini(
                apiKey = apiKey,
                model = model.ifBlank { DEFAULT_MODEL },
                systemInstruction = RESCUE_SYSTEM,
                userText = "현재 행동: $currentAction\n상태: $reason",
                schema = rescueSchema(),
                maxOutputTokens = 400
            )
            val o = JSONObject(raw)
            val action = o.optString("action").trim()
            require(action.length in 4..180) { "구조 행동 형식이 올바르지 않음" }
            action
        }
    }

    private fun callGemini(
        apiKey: String,
        model: String,
        systemInstruction: String,
        userText: String,
        schema: JSONObject,
        maxOutputTokens: Int
    ): String {
        val endpoint = "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent"
        val payload = JSONObject()
            .put(
                "systemInstruction",
                JSONObject().put(
                    "parts",
                    JSONArray().put(JSONObject().put("text", systemInstruction))
                )
            )
            .put(
                "contents",
                JSONArray().put(
                    JSONObject()
                        .put("role", "user")
                        .put("parts", JSONArray().put(JSONObject().put("text", userText)))
                )
            )
            .put(
                "generationConfig",
                JSONObject()
                    .put("temperature", 0.2)
                    .put("candidateCount", 1)
                    .put("maxOutputTokens", maxOutputTokens)
                    .put("responseMimeType", "application/json")
                    .put("responseSchema", schema)
            )

        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 12_000
            readTimeout = 20_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("X-goog-api-key", apiKey)
        }

        try {
            connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(payload.toString()) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.let {
                BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use { reader -> reader.readText() }
            }.orEmpty()

            if (code !in 200..299) {
                val message = runCatching {
                    JSONObject(body).optJSONObject("error")?.optString("message")
                }.getOrNull().orEmpty()
                throw IllegalStateException("Gemini HTTP $code${if (message.isNotBlank()) ": $message" else ""}")
            }

            val response = JSONObject(body)
            val candidates = response.optJSONArray("candidates")
            require(candidates != null && candidates.length() > 0) { "Gemini 응답에 후보가 없음" }
            val parts = candidates.getJSONObject(0)
                .getJSONObject("content")
                .getJSONArray("parts")
            val text = buildString {
                for (i in 0 until parts.length()) {
                    append(parts.getJSONObject(i).optString("text"))
                }
            }.trim()
            require(text.isNotBlank()) { "Gemini 응답이 비어 있음" }
            return text
        } finally {
            connection.disconnect()
        }
    }

    internal fun parsePlan(source: String, raw: String): AtomicPlan {
        val root = JSONObject(raw)
        val array = root.optJSONArray("actions") ?: JSONArray()
        val actions = buildList {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                val action = item.optString("action").trim()
                val minutes = item.optInt("minutes", 5).coerceIn(3, 8)
                val rationale = item.optString("rationale", "작게 끝낼 수 있는 실행 단위").trim()
                if (action.length >= 4 && action.none { it == '\u0000' }) {
                    add(AtomicAction(action, minutes, rationale.take(100)))
                }
            }
        }
            .distinctBy { it.action }
            .take(8)

        require(actions.size >= 2) { "AI가 충분한 행동을 만들지 못함" }
        return AtomicPlan(source = source.trim(), actions = actions)
    }

    private fun planSchema(): JSONObject = JSONObject()
        .put("type", "OBJECT")
        .put(
            "properties",
            JSONObject().put(
                "actions",
                JSONObject()
                    .put("type", "ARRAY")
                    .put("minItems", 2)
                    .put("maxItems", 8)
                    .put(
                        "items",
                        JSONObject()
                            .put("type", "OBJECT")
                            .put(
                                "properties",
                                JSONObject()
                                    .put("action", JSONObject().put("type", "STRING"))
                                    .put("minutes", JSONObject().put("type", "INTEGER").put("minimum", 3).put("maximum", 8))
                                    .put("rationale", JSONObject().put("type", "STRING"))
                            )
                            .put("required", JSONArray().put("action").put("minutes").put("rationale"))
                    )
            )
        )
        .put("required", JSONArray().put("actions"))

    private fun rescueSchema(): JSONObject = JSONObject()
        .put("type", "OBJECT")
        .put(
            "properties",
            JSONObject()
                .put("action", JSONObject().put("type", "STRING"))
                .put("rationale", JSONObject().put("type", "STRING"))
        )
        .put("required", JSONArray().put("action").put("rationale"))

    private val PLAN_SYSTEM = """
        너는 Tether의 Task Compiler다. 한국어로 답한다.
        사용자의 공부 목표를 3~8분 안에 끝낼 수 있는 관찰 가능한 행동 2~8개로 분해한다.
        규칙:
        1. '공부하기', '복습하기', '집중하기' 같은 추상적 행동을 쓰지 않는다.
        2. 각 행동은 무엇을 보고/가리고/적고/풀고/채점할지 분명해야 한다.
        3. 가능하면 입력→인출→채점/확인→오류 재인출 순서를 사용한다.
        4. 문제풀이는 '조건 표시→첫 식→풀이→채점'처럼 시작 마찰을 줄인다.
        5. 암기는 재독보다 인출을 우선한다.
        6. 집중 위험이 높으면 행동을 3~5분으로 더 작게 만든다.
        7. 동기부여 문구, 칭찬, 장황한 설명은 만들지 않는다.
        8. 사용자가 적지 않은 사실이나 교과 내용을 지어내지 않는다.
        출력은 제공된 JSON 스키마만 따른다.
    """.trimIndent()

    private val RESCUE_SYSTEM = """
        너는 Tether의 Rescue Compiler다. 한국어로 답한다.
        현재 공부 행동이 막혔을 때 30~90초 안에 시작 가능한 '물리적으로 관찰되는 한 동작' 하나로 축소한다.
        예: '문제 풀기' → '조건에 밑줄 긋고 구하려는 값 옆에 ? 쓰기'.
        완성보다 재시작을 목표로 한다. 동기부여 문구는 쓰지 않는다.
        출력은 제공된 JSON 스키마만 따른다.
    """.trimIndent()
}
