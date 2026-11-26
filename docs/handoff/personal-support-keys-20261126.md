# Personal support, employee Key management, call details and payment marks

## Scope and release

- User approved billing publication, then requested support simplification, employee Key cap editing, per-call usage and official payment logos while continuing public testing.
- Billing release `572982c7ff2c6c780433925526bf1ce05c0c2527` was deployed and verified on public `release.json` and authenticated browser: recharge, balance, consumption empty state. No payment submitted.
- Follow-up `df185f894a82cce7dd82279071e20419db69e806` deployed successfully; server API and static release probes match, container healthy. Release directory `/srv/oneapi-data/oneapi-cutover-q72dymap/releases/df185f894a82.ahDR5V`; local deployment log `/private/tmp/oneapi-support-release.log`.
- Authenticated public browser verified both payment assets loaded and displayed, support form/tabs, and usage call-details tab/empty state. Existing VIP test account has no real calls; populated data and employee cap changes were tested locally, not on real customer records.

## Changes

- Personal Support: submit issue / my tickets / FAQ; three list items per page, separate paginated text detail; draft retained between tabs, no late async rerender while typing; explicit loading, empty, retry states. Enterprise support retains its existing renderer. Ticket API still returns latest 50 records, indicated at the threshold.
- Employee Key `manage` endpoints for owner and enterprise manager: label and cap; only active, unexpired API-purpose keys in the authorized organization. Cap floor includes settled usage and active holds; ceiling equals this Key's used/held plus employee available quota. Null restores the existing shared employee quota behavior. Changes do not increase employee total or reserve budget across keys. Audit event `employee_credit.key_updated`.
- Management and inference use the employee account lock. Inference rereads the current cap after taking that lock, preventing a pre-authenticated request from using the previous cap after an edit. Existing stop/rate-limit actions remain.
- Personal usage adds per-call details via `/api/customer-credit/usage/calls`, owner-scoped and period-filtered; backend pagination (2/3 per page), stable time+id order, includes revoked keys and unsettled/failed calls, excludes comparison purpose. Cash sums credit-consumption rows once per call; pending stays “待结算”; official quota consumption shown separately. Cache hit tokens are a subset of input.
- Recharge choices now use official Alipay icon and complete WeChat Pay vector signature, preserving colors/proportions. Amount/promo survive method changes. Original source URLs recorded in `web/assets/payments/README.md`; production builder explicitly includes only the two assets.

## Verification

- Temporary PostgreSQL integration: employee credit full scenario including new owner/manager permission, amount validation, quota ceiling, active-hold floor, restoring shared quota, audit and revoked-key rejection.
- Usage DB test: all 104 calls reachable across pages, multiple packs charged once, revoked keys retained, other account/compare keys isolated; invalid pages rejected.
- Personal UI/model/settings/navigation regressions 26/26. Long support content preserves all characters including Unicode and blank lines.
- Browser: support form, draft tab retention, list and long reply pagination; personal call details, pagination and unsettled/failed labels; employee mock Key cap saved 5 → 7.5, success shown; payment logos load and method switch retains 125.50.
- 1280×720 / 1280×640 and 391×685 tested; final mobile support, call details and logo recharge stage 464/464. Layout uses pagination, not hidden overflow.
- No live ticket, real employee quota modification, credential creation or payment was performed.

## Local previews

- 4186: `/private/tmp/oneapi-support-preview.py`, mock personal billing/support/usage; `scenario=existing|empty|error`.
- 4187: `/private/tmp/oneapi-employee-preview.py`, mock company member; `#organization/preview-org/keys`.
- Prior 4181–4185 previews preserved. All read live repository frontend files.
- Untracked `.workbuddy/`, unrelated CW/design documents, and `output/` belong to other work and were not committed.
