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


## Release progress / operational fallback
- PR #152 merged as dd02fde01731e007c8bace802fe408fc7743cae7.
- Direct upload was slow and terminated while incomplete; relay through the existing trusted m4 SSH jump host uploaded and verified the same bundle. Static/API remained on the recorded baseline while Docker's pinned base-image download stalled.
- Add optional ONEAPI_USE_EXISTING_NODE=1: verify the existing image runs the exact Node version requested by Dockerfile on the Linux production runtime, then reinstall dependencies using npm ci --omit=dev --ignore-scripts from the committed lockfile. Application source remains committed. No host-key bypass or production configuration changes.
- Removed clean, merged and unused worktrees/local branches: codex/personal-settings-release, codex/recharge-cash-first-20261125, codex/simplify-personal-toolbar-20261125. Confirmed no changed/untracked/ignored files, process cwd, runtime-script, launch-agent or application-project references. Other trees retained, including account-decimal-hotfix still referenced by a preview and local main with unrelated work.
- Commission calculation remains untouched; the personal view wording describes reporting attribution only. Existing settlement ledger is retained pending the user's separate policy decision.

- Runtime inspection found a shell-free production image, Node v24.22.2 x64. The dependency build runs the installed npm CLI directly using Node inside that Linux image, installs with lifecycle scripts disabled, and copies only lockfile-installed application dependencies to the final image. No macOS application node_modules are reused; npm bootstrap is excluded from the final image.

## Final release receipt
- PR #154 merged as 97045916efc3e14d96a3b28ae61951e833d0bea3. Public release.json and /api/status both report this SHA; production container oneapi-sh-api uses this image and is healthy. The earlier dd02fde full build completed naturally; no remote activation was interrupted.
- Final combined server suite: 287 tests, 264 passed, 23 skipped, zero failures. A subsequent guarded publication stopped before mutation because the live baseline had changed; read-only verification confirmed the desired 9704591 was already deployed. No redundant deployment performed.
- Public VIP entry was visually verified at https://semifly.cn/#personal/vip. The available browser identity shows the compact application/program view; active-VIP dashboard acceptance used local fixtures and integration tests. Real payment/refund/withdrawal/signing remains untested.
- Remote main subsequently advanced with unrelated employee PR #155; it retains the deployed VIP commits. Do not chase concurrent changes by repeatedly deploying or clean another task's worktree.
- User raised variable model costs and universal recharge-discount losses. Proposed direction only: cash-denominated balance, per-model/component selling prices, bounded promotional benefit and commission budget, versioned tariffs. No new prices, recharge eligibility or commission formula were implemented. Existing customer obligations need a separate migration decision.
