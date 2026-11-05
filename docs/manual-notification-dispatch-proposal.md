# Safe manual notification dispatch: implementation plan

Status: proposal only. No production send or schedule change is included in this branch.

## Objective
Allow an authorized administrator to request an on-demand check or catch-up of an **already scheduled** experiment notification, without creating an extra exposure, changing 0/3/6 assignments, or overriding consent.

## Required behavior
1. Keep the current scheduled dispatcher unchanged until separately reviewed.
2. Provide a manual workflow with `dry_run` as the default and an explicit `slot_index` (0–5) and confirmation for any send.
3. Validate the requested slot against the server-side active experiment configuration; never accept an arbitrary notification count or recipient list.
4. Require the slot to be scheduled for the **current KST date**, and enforce a documented, finite catch-up window. Never backdate `now` to bypass consent or experiment-period checks.
5. Recheck active experiment, pause flag, current participant consent, valid push subscription, assignment, planned slot, and the receipt **immediately before** each FCM send.
6. Use the existing deterministic notification ID and atomic receipt claim. Treat `sending`, `send-uncertain`, and `fcm-accepted` as locked to prevent duplicates. Do not reset receipts to force retries.
7. Refuse LOW (0/day) recipients and preserve the MID/HIGH daily budgets. Do not send to an opt-out, inactive account, or an unregistered device.
8. Separate diagnostic results: eligible, opted-out, no-token, already-sent, skipped-outside-window, FCM-accepted, FCM-failed. Never log tokens, personal identifiers, or message bodies.
9. Record actor, timestamp, requested slot, dry-run status, code revision, and aggregate outcome in an audit log.
10. Protect the workflow with environment approval and minimum GitHub permissions. Never put Firebase credentials into pull-request workflows.

## Acceptance tests
- Dry run cannot call `messaging.send`.
- LOW receives zero even when the operator requests a HIGH slot.
- MID receives only its planned slots; HIGH never exceeds six per day for parallel-v4.
- Opt-out between selection and claim prevents sending.
- Two concurrent manual/scheduled dispatches produce at most one FCM call per receipt.
- Existing accepted/uncertain receipts cannot be resent.
- Invalid slot, wrong date, outside catch-up window, inactive experiment, or missing approval fails closed.
- Logs contain only aggregate counts and no push tokens or user IDs.

## Release sequence
1. Implement and unit-test manual dry-run first.
2. Review with the experiment owner and supervising teacher, including the impact of delayed exposure on research validity.
3. Enable manual sending only after explicit production approval.
4. Validate on one approved test device before considering wider authorized use.

**This proposal does not authorize sending messages or deploying to production.**
