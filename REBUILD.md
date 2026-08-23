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
- [ ] New responsive app shell
- [ ] Atomic router
- [ ] Canonical read-only data gateway
- [ ] Today / Timetable / Schedule / Class / More information architecture

### Day 2 — Data and trust

- [ ] Connect existing Firestore collections through the gateway
- [ ] Search state model
- [ ] Notification inbox state model
- [ ] New authenticated role model design
- [ ] Audit-log and restore contract

### Day 3 — QA and preview

- [ ] Compact: 360 / 390 / 430 px
- [ ] Medium: 768 / 820 / 821 px
- [ ] Expanded: 1024 px+
- [ ] Android Chrome / iOS Safari / Chromebook / desktop Chrome
- [ ] Keyboard and screen-reader pass
- [ ] Preview deployment only; production promotion remains manual

## Release gate

PinCon Next does not replace production until all of these are true:

- shared writes require authenticated roles and leave an audit record;
- selected navigation and visible content never disagree;
- navigation either settles within 300 ms or exposes an explicit loading state;
- search, notifications and class features read from the same canonical data model;
- no fixed navigation, FAB or dialog layer covers usable content;
- rollback to the frozen legacy commit has been rehearsed.
