# Kabuyomi UI Spec For Claude Code

> Historical / stale document. Not current v1 release truth. See `docs/release/RELEASE_TRUTH.md`.

## Purpose

Kabuyomi should feel less like "a nice chat app" and more like "an app that makes it instantly obvious what an investor should ask about this filing right now."

This spec is a focused UI handoff for Claude Code. It is intentionally narrow.

## Current product direction

- Keep conversation-first UX.
- Keep the left drawer / right summary drawer structure.
- Keep the existing beige / brown / rounded / quiet visual language.
- Optimize for investor next action, not for generic onboarding polish.
- Do not redesign navigation architecture.
- Do not change backend logic or API wire shapes.
- Do not expand scope beyond UI and local display logic.

## Screenshots to use as reference

- [01-conversation-main.jpg](../../artifacts/ui-screenshots/01-conversation-main.jpg)
- [02-conversation-library.jpg](../../artifacts/ui-screenshots/02-conversation-library.jpg)
- [03-settings-top.jpg](../../artifacts/ui-screenshots/03-settings-top.jpg)
- [04-privacy-policy.jpg](../../artifacts/ui-screenshots/04-privacy-policy.jpg)
- [05-settings-links-and-reset.jpg](../../artifacts/ui-screenshots/05-settings-links-and-reset.jpg)
- [06-summary-drawer.jpg](../../artifacts/ui-screenshots/06-summary-drawer.jpg)

## What is already implemented

### 1. Conversation screen

- Suggested investor questions are shown directly under `Live Filing`.
- Composer placeholder is filing-context-oriented.
- "Cannot verify" responses now show softer copy plus follow-up chips.
- Source labels are humanized instead of showing internal-looking IDs.
- Right summary drawer is reordered into investor reading order.

### 2. First-run entry

- Fresh install no longer drops the user straight into the conversation screen.
- First run now shows a lightweight entry screen:
  - choose one starter ticker
  - open that company directly
  - or jump into conversation with one of three starter questions
  - or go to search
- Tapping a starter question opens the conversation screen with that question prefilled in the composer.

### 3. Starter ticker fade-out

- Starter tickers should not stay prominent forever.
- After the user has already completed the initial entry flow, starter ticker visibility auto-turns off on the 5th app launch.
- This auto-hide happens once.
- Users can re-enable starter tickers from Settings if they want them back.

## Product intent for onboarding

The first-run experience should be:

- lightweight
- one-screen
- immediately legible
- not "tutorial-like"
- not "marketing-like"

The user should understand this in under 3 seconds:

1. Pick one company.
2. Start from one strong question.
3. Enter the actual conversation screen.

Do not turn onboarding into a multi-step flow, carousel, or illustration-heavy intro.

## Desired UX principles

### A. Investor action beats explanation

Prefer:

- a visible ticker choice
- a visible next question
- a single dominant action

Over:

- long descriptive text
- feature explanation blocks
- stacked cards that explain the product too much

### B. First screen should feel like a threshold, not a separate mode

The first-run screen is not a standalone product area.

It should feel like a thin layer before the real conversation screen:

- same color language
- same tone
- same typography family
- low cognitive overhead

### C. Starter tickers are scaffolding, not a permanent navigation pillar

- Strong on first run
- Light in early use
- Gone by default after the user is clearly active

## Constraints

- Do not change API models for the sake of this work.
- Do not redesign drawers into tabs or a brand-new layout.
- Do not introduce a heavy onboarding subsystem.
- Do not rebuild the app shell.
- Do not add analytics plumbing unless strictly local and trivial.
- Do not change Workers behavior.

## Files most relevant to this work

- [ios/Kabuyomi/App/AppRootView.swift](../../ios/Kabuyomi/App/AppRootView.swift)
- [ios/Kabuyomi/App/AppModel.swift](../../ios/Kabuyomi/App/AppModel.swift)
- [ios/Kabuyomi/Features/Home/HomeView.swift](../../ios/Kabuyomi/Features/Home/HomeView.swift)
- [ios/Kabuyomi/Features/Company/CompanyView.swift](../../ios/Kabuyomi/Features/Company/CompanyView.swift)
- [ios/Kabuyomi/Features/Search/SearchView.swift](../../ios/Kabuyomi/Features/Search/SearchView.swift)
- [ios/Kabuyomi/Features/Settings/SettingsView.swift](../../ios/Kabuyomi/Features/Settings/SettingsView.swift)

## If Claude Code is asked to refine this further

Prioritize only these, in order:

1. Make the first-run entry even lighter without losing clarity.
2. Keep the first-run CTA and starter question chips above the fold on common iPhone sizes.
3. Reduce explanatory copy before removing action clarity.
4. Make the selected starter ticker state feel crisp and obvious.
5. Keep the transition from first-run entry to conversation feeling immediate.

## Explicit non-goals

- No backend schema work
- No billing redesign
- No drawer architecture rewrite
- No major navigation redesign
- No new tab structure
- No redesign of theme, palette, or visual identity
- No 20-F support work

## Acceptance bar

Claude Code should consider the work successful only if:

- a new user immediately sees one company to pick and one question to ask
- the first screen does not feel like a separate product mode
- the conversation screen still feels like the core of the app
- starter tickers naturally recede after repeated launches
- existing quiet visual language remains intact
