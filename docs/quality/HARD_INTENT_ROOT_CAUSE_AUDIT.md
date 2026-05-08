# Hard Intent Root Cause Audit

Date: 2026-05-06 JST

## Baseline Symptom

Minimal Core 60 shows zero invalid source IDs, but hard-intent families still fall back:

- `revenue_driver`: 5/5 fallback
- `driver_durability_followup`: 5/5 fallback
- `margin_durability_followup`: 5/5 fallback

## Root Cause Hypothesis

The primary blocker is source asset shape, not only ranking:

- Current first-class chunks are `md_a` and `xbrl_metric`.
- Required narrative sections such as Business, Risk Factors, Segment, Revenue Note, Liquidity, Debt, and Cash Flow discussion are not stored as stable section families.
- Hard-intent retrieval can create supplemental windows, but those windows do not replace the need for stable, labeled section assets.

## Current Guard Behavior

The source gate remains conservative. When driver or durability evidence is missing, fallback is preferable to unsupported claims. The v1.1 goal is to reduce honest insufficiency by supplying better evidence, not to loosen the gate.

## Measurement Added First

This branch begins by persisting source family/type and token attribution fields in testbench rows. That lets later retrieval changes show whether:

- narrative source share increased
- required source families are present
- hard-intent retrieval added sources
- fallback decreased without `sourceIdsValid` regression

## Next Structural Work

The next implementation phase should add backward-compatible first-class section families, then introduce a central intent-to-section map and make the hard-intent source gate report missing required families explicitly.
