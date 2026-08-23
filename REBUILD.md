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
3. Next beta is read-only until the new role model is enforced server-side.
4. Route selection and visible content commit together.
5. Mobile uses bottom navigation; wider layouts use a rail. Fixed navigation may never cover content.
6. Modal/scrim layers suppress background navigation interaction.
7. Destructive records use recoverable archive/soft-delete semantics with audit history.
8. Legacy remains restorable throughout the beta.

## Three-day beta scope

### Day 1 — Core shell

- [x] Freeze legacy branch
- [x] Create isolated rebuild branch
- [x] New responsive app shell
- [x] Atomic router
- [x] Canonical read-only data gateway
- [x] Today / Timetable / Schedule / Class / More information architecture

### Day 2 — Data and trust

- [x] Connect existing Firestore collections through the gateway (read-only)
- [x] Search state model and working basic search
- [x] Notification inbox read/unread history model
- [x] New authenticated role model design contract
- [x] Audit-log and restore contract
- [x] Validate the new role/audit contract in isolated Next Firestore rules and privilege-bypass emulator tests

The Day 2 server contract is validated in `next/firestore-next.rules`, but it is intentionally not deployed over the production `firestore.rules`. `NEXT_WRITE_GATE.enabled` remains `false`, so shared writes stay locked until production migration is explicitly approved.

### Day 3 — QA and preview

- [x] Automated Compact: 360 / 390 / 430 px
- [x] Automated Medium: 768 / 820 / 821 px
- [x] Automated Expanded: 1024 px+
- [x] Chromium + WebKit responsive smoke
- [x] Chromium + WebKit keyboard/accessibility smoke
- [ ] Android Chrome / iOS Safari / Chromebook / desktop Chrome real-device pass
- [ ] VoiceOver / TalkBack real-device pass
- [x] Preview deployment only; production promotion remains manual

## Current Next entry point

- Source: `next/`
- Preview branch: `rebuild`
- Production `main` is intentionally unchanged.
- Next reads the existing class profile and current Firestore collections but exposes no shared write methods.
- Notification read state is class-scoped and stored locally during Beta; reading an alert does not mutate class data.
- Role mapping, audit events, soft-delete and restore patches are defined in `next/core/trust-model.js`, with the write gate forced closed.
- Read-only admin Beta lives at `next/admin/` and requires manager/system-admin access.

## Preview deployment status

- Vercel `pine` Root Directory was corrected from the OCR proxy subproject to repository root on 2026-08-23.
- A clean redeploy of the older `5d839b7` rebuild commit now serves `/next/` with HTTP 200, confirming the previous 404 was a Vercel root-directory configuration issue rather than a PinCon Next route issue.
- A fresh `rebuild` commit is used to trigger a Preview containing the current admin/accessibility/security work before final preview verification.

## Release gate

PinCon Next does not replace production until all of these are true:

- shared writes require authenticated roles and leave an audit record;
- selected navigation and visible content never disagree;
- navigation either settles within 300 ms or exposes an explicit loading state;
- search, notifications and class features read from the same canonical data model;
- no fixed navigation, FAB or dialog layer covers usable content;
- rollback to the frozen legacy commit has been rehearsed.
