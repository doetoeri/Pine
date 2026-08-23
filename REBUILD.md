# PinCon Rebuild

## Restore point

- Frozen production commit: `795bb2f0c37302dd1eeeaecf4b28aa7b844f914d`
- Frozen branch: `legacy/2026-08-23`
- Rebuild branch: `rebuild`
- `main` stays untouched until the Next beta passes the release gate.

### Emergency restore

1. Stop promoting preview deployments.
2. Point production back to `main`, or to commit `795bb2f0c37302dd1eeeaecf4b28aa7b844f914d` if `main` has moved.
3. Do not migrate or delete legacy Firestore data during the beta.

## Non-negotiable rebuild rules

1. One PinCon app, one global navigation model.
2. One source of truth for each domain object.
3. General Next shared writes stay locked until the new role model is enforced server-side. The only Beta exception is the existing production `classSettings/{classKey}` path, which already enforces class-operator scope and change logging for the class brand tagline.
4. Route selection and visible content commit together.
5. Mobile uses a floating bottom dock; tablet uses a compact floating rail; desktop uses an expanded floating navigation panel. Fixed navigation may never cover content.
6. Modal/scrim layers suppress background navigation interaction.
7. Destructive records use recoverable archive/soft-delete semantics with audit history.
8. Legacy remains restorable throughout the beta.

## Three-day beta scope

### Day 1 — Core shell

- [x] Freeze legacy branch
- [x] Create isolated rebuild branch
- [x] New responsive app shell
- [x] Atomic router
- [x] Canonical single-instance data gateway
- [x] Today / Timetable / Schedule / Class / More information architecture

### Day 2 — Data and trust

- [x] Connect existing Firestore collections through the gateway
- [x] Search state model and working basic search
- [x] Notification inbox read/unread history model
- [x] New authenticated role model design contract
- [x] Audit-log and restore contract
- [x] Validate the new role/audit contract in isolated Next Firestore rules and privilege-bypass emulator tests
- [x] Reuse the existing protected `classSettings` + `changeLogs` path for the narrowly scoped class brand-tagline editor

The general Day 2 server contract is validated in `next/firestore-next.rules`, but it is intentionally not deployed over the production `firestore.rules`. `NEXT_WRITE_GATE.enabled` remains `false`, so announcements, resources, destructive actions and other general Next shared writes stay locked. The brand tagline is a narrow exception because the existing production rule already checks the class operator for `classSettings/{classKey}` and the repository writes a corresponding change log.

### Day 3 — QA and preview

- [x] Automated Compact: 360 / 390 / 430 px
- [x] Automated breakpoint edge: 600 / 839 / 840 px
- [x] Automated Medium: 768 / 820 px
- [x] Automated Expanded: 1024 px+
- [x] Chromium + WebKit responsive smoke
- [x] Chromium + WebKit keyboard/accessibility smoke
- [x] Route latency regression target: under 300 ms
- [x] Brand tagline render regression on mobile + desktop
- [ ] Android Chrome / iOS Safari / Chromebook / desktop Chrome real-device pass
- [ ] VoiceOver / TalkBack real-device pass
- [x] Preview deployment only; production promotion remains manual

## Current Next entry point

- Source: `next/`
- Preview branch: `rebuild`
- Stable branch preview: `https://pine-git-rebuild-doeyoungkims-projects.vercel.app/next/`
- Admin preview: `https://pine-git-rebuild-doeyoungkims-projects.vercel.app/next/admin/`
- Production `main` is intentionally unchanged.
- The stable branch URL follows the latest successful Vercel deployment of `rebuild`; Vercel Deployment Protection may require sign-in.
- Next reads the existing class profile and current Firestore collections through a page-level singleton gateway.
- Notification read state is class-scoped and stored locally during Beta; reading an alert does not mutate class data.
- Role mapping, audit events, soft-delete and restore patches are defined in `next/core/trust-model.js`, with the general write gate forced closed.
- The limited admin Beta lives at `next/admin/` and requires manager/system-admin access; the brand tagline editor additionally requires the existing production class-operator permission.

## Preview deployment status

- Vercel `pine` Root Directory was corrected from the OCR proxy subproject to repository root on 2026-08-23.
- `/next/` has been verified with HTTP 200 on corrected-root Vercel deployments.
- Adaptive floating navigation, supplied SVG logo, boot stabilization and the class brand-tagline model have successful Preview deployments.
- Newer commits may temporarily lag behind the stable alias when the Vercel Hobby build-rate limit is reached; the alias updates again on the next successful `rebuild` deployment.

## Release gate

PinCon Next does not replace production until all of these are true:

- general shared writes require authenticated roles and leave an audit record;
- the class brand-tagline exception remains restricted to the existing protected `classSettings` path and change logging;
- selected navigation and visible content never disagree;
- navigation settles within 300 ms or exposes an explicit loading state;
- search, notifications and class features read from the same canonical data model;
- no floating navigation, FAB or dialog layer covers usable content;
- rollback to the frozen legacy commit has been rehearsed.
