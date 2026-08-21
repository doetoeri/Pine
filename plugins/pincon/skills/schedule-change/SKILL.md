---
name: pincon-schedule-change
description: Check PinCon for timetable-change notices and explain the current schedule for the connected class without mixing old and new periods.
---

Use this skill when the user asks whether the timetable changed, what changed, or which schedule is current.

1. Call `get_notices` and look for timetable or class-change notices relevant to the requested date.
2. Call `get_timetable` for that same date to obtain the current stored timetable.
3. Treat the current timetable returned by `get_timetable` as the authoritative current schedule unless PinCon explicitly indicates otherwise.
4. Summarize changes as `old → new` when the notice contains both values.
5. Do not reconstruct an old timetable from incomplete information.
6. If PinCon has no change notice, say that no recorded change notice was found rather than claiming that no change occurred in reality.
7. Keep the result concise and highlight affected periods.
