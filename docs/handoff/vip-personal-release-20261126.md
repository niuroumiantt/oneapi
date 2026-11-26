# VIP personal workspace release — 2026-11-26

## Scope
Based on remote main 60ca3ac; integrates codex/vip-workspace-20261126 through 45bb1ed. Separate release tree avoids unrelated local-main employee work and untracked files.

- VIP uses the personal workspace navigation and compact paginated pages: overview, promotion codes, inbox, commission/withdrawals, profile/contracts.
- Overview separates cumulative promotional customer payments/use/booked commission from personal account payments/use. Own purchases through a promotion code are excluded from promotional metrics and its detailed activity view. Personal accounts exclude organization billing accounts; use is consumed cash, not gifted face credit.
- Three independent amounts with restrained color rules replace the stacked cash chart. Personal payment codes remain accessible under personal use.
- Code creation receipt confirms actual payment code and discount, then returns to code list. Per-code payment/use/refund details are scoped and redact customer identity.
- Monthly PDF statements are generated privately by the backend worker with versioned snapshots and an inbox; monthly/late-event behavior and authorization tested. Existing ledger computation remains unchanged.
- No new 10% rate or other commission policy is introduced. Rates, basis, refunds and settlement rules require a separate decision. No money or signing transaction executed for release acceptance.
- Include code-activity HTML/JS/CSS in the explicit static publication manifest. Deployment checks observed web/API baselines under the release lock before mutation.

## Validation
- Full server suite: 249 passed, 21 skipped (dedicated integrations not configured in that run), 0 failed.
- Dedicated CW + monthly statement integration: 23 passed. Code activity and separate personal/promotion metrics integration: 6 passed.
- Final navigation/loading/VIP UI focused tests: 19 passed.
- Browser: overview (both views), code list/pagination and profile checked in 1000×464 and 390×550 frames; no content overflow. PDF rendering test embeds Chinese and spans complete records.
- Local preview is simulated, localhost:4286, with disposable local PostgreSQL on 55527. No production credentials in fixtures.

## Deployment / cleanup
Authorized by user: commit, merge remote main, public deployment and remove unused local branches. Preserve all dirty, unmerged or in-use trees and unique ignored files. Production baseline before release: static dac57e5dfc5e0794e471928455ea8ee04e7c7c66; API 95a365b20755889b65e774702817e56f84c853b4. Deployment receipt will be appended after verification.
