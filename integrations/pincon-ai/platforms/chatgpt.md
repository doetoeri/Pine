# ChatGPT / Codex integration

PinCon's ChatGPT-facing product is the **PinCon Plugin**.

The Plugin lives at `plugins/pincon/` and packages:

- the PinCon MCP app connection,
- Daily Brief Skill,
- Weekly Planner Skill,
- Absence Recovery Skill,
- Schedule Change Skill.

## Required app connection

- MCP URL: `https://pincon-ai.vercel.app/api/mcp`
- Authentication: OAuth 2.1 authorization code + PKCE S256
- Scope: `pincon:read`
- Data access: read-only

The MCP server advertises OAuth through its protected-resource metadata, so supported ChatGPT/Codex app setup flows should discover the PinCon authorization server instead of asking users for the development service key.

## Plugin package

`plugins/pincon/.codex-plugin/plugin.json` is the plugin manifest. Each Skill declares its PinCon MCP dependency through `agents/openai.yaml`.

Do not commit a fabricated ChatGPT app technical ID. If the platform issues an app mapping/technical ID during app registration, store that mapping only after the real PinCon app has been created.

## Test prompts

- `@PinCon 오늘 뭐 있어?`
- `@PinCon 이번 주 수행평가와 일정을 정리해줘.`
- `@PinCon 어제 결석했어. 놓친 내용을 정리해줘.`
- `@PinCon 최근 시간표 변경만 알려줘.`

All factual school-life data should come from PinCon tools. The Skills may organize and summarize tool output but must not invent missing timetable, meal, assignment, notice, or event data.
