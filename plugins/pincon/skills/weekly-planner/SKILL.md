---
name: pincon-weekly-planner
description: Summarize upcoming PinCon assignments, assessments, and school events into a practical weekly plan for the connected class.
---

Use this skill when the user asks what is coming up this week, which days are busy, or what school tasks should be prioritized.

1. Call `get_upcoming` with an appropriate day window, usually 7 days.
2. If exact dates or more context are needed, call `get_assignments` and `get_school_events` for the same range.
3. Use only the connected class. Do not query other classes to compare workloads.
4. Group results by date and sort chronologically.
5. Put assessments and assignments before general events when they share a date.
6. Clearly distinguish recorded deadlines from your own planning suggestions.
7. If the user asks which day is busiest, base the answer only on the returned PinCon items and explain the simple criterion used.
8. Do not invent preparation time, difficulty, grades, or teacher requirements that PinCon did not return.

When useful, finish with a short "prepare first" section containing only tasks supported by the retrieved data.
