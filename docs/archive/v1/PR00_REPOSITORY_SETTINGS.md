# PR-00 Repository Settings

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

Last verified: 2026-07-10 JST

Repository: `zuisei/Kabuyomi_FET`

Branch: `main`

## Current verified state

Read-only GitHub API checks on 2026-07-10 reported that `main` is not protected, no repository rulesets are configured, and no required status checks are enforced. This document is therefore a required manual configuration checklist, not a claim that the settings are already enabled.

## Required `main` branch protection

Configure a branch ruleset for `main` with these controls:

- Require a pull request before merge.
- Require at least one approval and dismiss stale approvals after new commits.
- Require all review conversations to be resolved.
- Require branches to be up to date before merge.
- Block force pushes and branch deletion.
- Apply the rules to administrators.
- Do not allow direct pushes to `main` except through an explicitly documented emergency role.

Require these exact check names from `.github/workflows/pull-request-ci.yml`:

- `Repository sanity`
- `Worker`
- `Worker dry-run`
- `Testbench`
- `D1 migration order`
- `SEC fetcher`
- `Legal site`
- `iOS unit tests`
- `iOS unsigned Release`

Re-check the names after the first pull-request run before making the ruleset mandatory; GitHub only offers checks that have reported at least once.

## Protected live test benchmark

Create a GitHub environment named `test-worker-benchmark` for `.github/workflows/live-test-worker-benchmark.yml`:

- Require a human reviewer.
- Restrict deployment branches to `main` or an explicitly approved remediation branch.
- Store only test-account Cloudflare credentials in the environment: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- Set `KABUYOMI_TESTBENCH_BASE_URL` to the isolated test Worker as an environment variable.
- Ensure the Cloudflare token cannot deploy the production Worker or mutate production KV, D1, R2, or Durable Object state.
- Provision the remote test Worker `OPENAI_API_KEY` secret separately before the run. The workflow intentionally does not receive that provider key. Do not use `setup-test-secrets.mjs` in CI because it writes `.dev.vars` and performs remote secret mutation.

The workflow has no schedule and can run only through `workflow_dispatch`. It deploys `wrangler.test.toml`, never `wrangler.toml`.

## Production deployment freeze

PR CI must never receive production credentials. No pull-request workflow may deploy production or apply remote migrations.

Before any future production workflow is added:

1. Create a separate protected `production` environment with required reviewers.
2. Restrict it to protected `main` or signed release tags.
3. Keep production deploy and migrations out of `pull_request` triggers.
4. Require a green release-gate report and an explicit operator approval.
5. Use a narrowly scoped Cloudflare token and keep rollback/kill-switch procedures available.

Until those external settings are configured and verified, broad public or paid release remains `HOLD`.
