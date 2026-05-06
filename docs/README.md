# Docs

Project documentation that used to sit in the repository root is grouped here.

## Current References

- [project_file_map.md](./project_file_map.md): plain-English map of what the project is doing and what each meaningful file/module does
- [testflight_readiness_checklist.md](./testflight_readiness_checklist.md): practical checklist for shipping the current build to TestFlight
- [app_store_submission_notes.md](./app_store_submission_notes.md): App Store Connect review/privacy notes for the current release candidate
- [LEGAL_SITE_DEPLOYMENT.md](./LEGAL_SITE_DEPLOYMENT.md): Cloudflare Pages setup for static legal pages used by App Store metadata
- [APPLE_STORE_SERVER_CONFIG.md](./APPLE_STORE_SERVER_CONFIG.md): Worker secrets and App Store Server API setup for paid-credit verification
- [worker_refactor_tickets.md](./worker_refactor_tickets.md): Worker reliability/chat-quality refactor tickets for test-first work
- [chat_quality_contract.md](./chat_quality_contract.md): `/v1/chat` answer-quality contract and eval gate
- [specs/kabuyomi_spec_v3.md](./specs/kabuyomi_spec_v3.md): broad product and technical spec reference
- [specs/kabuyomi_as_built_spec.md](./specs/kabuyomi_as_built_spec.md): historical code-derived snapshot; not the current ship contract
- [specs/kabuyomi_positioning_spec_v1.md](./specs/kabuyomi_positioning_spec_v1.md): product positioning direction
- [specs/kabuyomi_engagement_spec_v1.md](./specs/kabuyomi_engagement_spec_v1.md): engagement and retention direction
- [specs/kabuyomi_conversational_ui_spec_v1.md](./specs/kabuyomi_conversational_ui_spec_v1.md): conversation-first UI spec

## Handoffs

- [handoffs/codex_refactor_instruction.md](./handoffs/codex_refactor_instruction.md): historical implementation brief; parts of it describe work that has already landed
- [handoffs/kabuyomi_claude_code_ui_spec_v1.md](./handoffs/kabuyomi_claude_code_ui_spec_v1.md): UI-specific handoff for iterative design work

## Suggested Reading Order

The local coordination docs (`docs/current_shipping_truth.md`, `CURRENT_SLICE.md`) are intentionally not tracked in Git.

1. `project_file_map.md`
2. `testflight_readiness_checklist.md`
3. `app_store_submission_notes.md`
4. current code under `ios/`, `workers/`, and `sec-fetcher/`
5. `specs/kabuyomi_spec_v3.md`
6. `specs/kabuyomi_positioning_spec_v1.md`
7. `specs/kabuyomi_engagement_spec_v1.md`
8. `specs/kabuyomi_conversational_ui_spec_v1.md`
9. `specs/kabuyomi_as_built_spec.md`
