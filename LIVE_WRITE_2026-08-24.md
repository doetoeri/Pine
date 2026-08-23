# PinCon live write window · 2026-08-24

- Class: `1-8`
- Client cutoff: `2026-08-24 23:59:59 KST`
- Server cutoff epoch: `1787583599000`
- Authentication: Firebase authenticated user; the student surface can start anonymous Firebase auth after collecting a 2–20 character display name.
- Temporary editor permissions: create/update `announcements`, `classAssignments`, `events`.
- Existing class operators keep their normal manager permissions, including archive/restore and brand settings.
- Temporary editors cannot archive/restore or edit class brand settings.
- Hard deletes remain disabled.
- Each temporary managed write is committed with a `changeLogs` record containing the Firebase UID and display name.
- Firebase deployment injects the temporary rule at deploy time and the server rule expires automatically by `request.time`.

After the cutoff, the client and server both return to role-based write access without requiring a rollback commit.
