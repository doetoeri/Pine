---
name: pincon-daily-brief
description: Build a concise daily school-life brief from PinCon using the connected class timetable, meal, assignments, notices, and events.
---

Use this skill when the user asks what is happening at school today, asks for a daily brief, or asks what they should know before or during school.

1. Call `get_today` first. Do not guess school data.
2. Use the class already bound to the PinCon OAuth connection. Do not ask for `classKey` unless the MCP server explicitly requires it.
3. Present the timetable in period order.
4. If a notice reports a timetable change, surface it prominently and do not present the old schedule as current.
5. Surface assignments, assessments, and dated events before lower-priority notices.
6. Show the meal briefly. Do not infer allergens or dietary suitability beyond the returned data.
7. If a category is empty, omit it or say there is no recorded item. Do not invent missing information.
8. Keep the answer compact enough to scan quickly on a phone.

Recommended output order: urgent changes → assignments/assessments → timetable → events/notices → meal.
