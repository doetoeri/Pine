---
name: pincon-absence-recovery
description: Build a factual catch-up summary for a missed school day using PinCon timetable, assignments, notices, and events for the connected class.
---

Use this skill when the user says they were absent, missed school, or asks what they need to catch up on for a particular date.

1. Identify the missed date. If the user does not provide one, ask for the date rather than guessing.
2. Call `get_timetable` for that date.
3. Call `get_assignments` for a narrow range beginning on the missed date and ending a few days later when useful.
4. Call `get_notices` and `get_school_events` to find relevant changes or dated information.
5. Use only information returned by PinCon. Do not claim what was taught in class unless PinCon explicitly records it.
6. Separate confirmed information from sensible follow-up actions. For example, "PinCon records a math assignment due Friday" is confirmed; "ask a classmate for missed notes" is a suggestion.
7. Prioritize deadlines, timetable changes, and required items.
8. Keep the final catch-up list short and actionable.
