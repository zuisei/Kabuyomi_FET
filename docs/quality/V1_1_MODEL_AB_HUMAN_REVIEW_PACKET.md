# Kabuyomi v1.1 Minimal Core 60 Model A/B Human Review Packet

Date: 2026-05-07

Branch: `v1.1-worker-quality-token-retrieval`

HEAD: `818387b`

## Executive Summary

No row-level human review packet could be produced because the requested A/B benchmark was blocked at model-config preflight.

Config B requested:

- Model: `gpt-5.4-nano`
- Reasoning effort: `none`

The current Worker only accepts `minimal`, `low`, `medium`, or `high`; `none` would silently resolve to `minimal`. Therefore, a full benchmark would not compare the requested configs.

## Overall Review Status

`INCONCLUSIVE: CONFIG FAILED PREFLIGHT`

## Missing Review Inputs

The following requested row sets are unavailable because no valid A/B run was generated:

- all Q03 rows
- all Q04 rows
- all Q06 rows
- rows where one config answered and the other fallbacked
- rows where token difference is greater than 25%
- rows with critical-looking labels
- rows where side-by-side classifier cannot choose

## Critical Failure Check

No benchmark-row critical failures were observed.

This is not a quality pass. It only means no live A/B rows were produced.

Preflight issue:

| Issue | Status | Human review impact |
| --- | --- | --- |
| Config B reasoning effort `none` cannot be represented by current Worker code | Blocking | Any B rows would be mislabeled as `none` while using effective `minimal` |

## Side-by-Side Review Table

| Scope | Config A row | Config B row | Review status |
| --- | --- | --- | --- |
| Minimal Core 60 | Not run | Not run | Blocked by Config B preflight |
| Q03 revenue driver | Not run | Not run | Blocked by Config B preflight |
| Q04 driver durability | Not run | Not run | Blocked by Config B preflight |
| Q06 margin durability | Not run | Not run | Blocked by Config B preflight |

## Human Reviewer Checklist

Before human review can proceed:

- Add or verify effective `none` support.
- Ensure `modelName` and effective `reasoningEffort` are recorded per row.
- Run one-row smoke for both configs.
- Confirm Config B does not silently resolve to `minimal`.
- Run both 60-row benchmarks on the same Worker code and same case set.
- Exclude infra/provider-contaminated rows from quality comparison.
- Then generate the row-level human review packet.

## Recommendation

`INCONCLUSIVE: CONFIG FAILED PREFLIGHT`
