# UI redesign state matrix

| Surface | Normal | Loading / pending | Empty | Disabled / gated | Failure / offline | Persistence / relaunch |
|---|---|---|---|---|---|---|
| App startup | Restored destination and company | Local bootstrap placeholder | First-entry discovery | Mutations gated while auth is not authoritative | One non-blocking authentication status; cached reads remain reachable | Active ticker, last viewed, saved and recent lists restore |
| Research discovery | Search, starters, recents | Search progress near results | Clear first action and examples | Unsupported filing types explain why they cannot open/save | Inline search error with valid retry | Recent companies restore |
| Research navigation | Discovery → company → sources → citation | Destination-local loading without replacing the stack | Back button and left-edge swipe return one level | Existing company/auth gates still control actions | Failed destination retains a usable native back path | Active company, filing selection, cache, and conversations stay in `AppModel` |
| Company workspace | Identity, filing scope, research document, composer | Company preparation or stale-ready state | No filing/research call to action | Save/send/translate gates remain visible and explained | Offline cached document plus precise retry action | Company, filing, messages, sources restore |
| Composer | Draft and two-credit cost | One pending request, input retained by state | Empty draft | No company, no consent, auth, capability, credits, or request in flight | Draft restored; error semantics preserved | Draft is presentation state only; sent conversation persists |
| Answers | Long-form readable document with adjacent citations | Pending user request/status | Research prompts when no history | Citation unavailable when no source URL | Source/detail error does not erase answer | Messages and source refs persist per filing |
| Filing/source browser | Current and cached filing versions, sources | Translation/source load | Explicit no cached sources | Translation/open action gated when invalid/unavailable | Original excerpt remains readable; retry only where valid | Active filing key restores through existing state |
| History | Saved companies and conversation-bearing filings; recent-company switching remains in Research | Placeholder hydration | Explicit saved/history empty message | Removal gated by auth | Cached rows stay usable offline | Saved order and Core Data history restore |
| Credits | Server balance, buckets, plans, packs, management, rewards | Usage, StoreKit metadata, purchase, restore, reward states | Explicit unavailable product/account states | Remote capabilities, App Attest, account, daily cap, emergency stop | Cancellation, pending, failure, backend grant failure remain distinct | Server balance/entitlement refresh after relaunch |
| Settings | Preferences, legal, data, Release-safe device/support information, Debug tools | Device authentication or diagnostics refresh | Device support code preparing | Debug sections absent in Release; safe six-character support code remains visible | Legal fallback, device-auth state, and diagnostics errors | Existing UserDefaults and installation identity restore |
| Reset | Confirmation first | Reset operation | Returns to discovery | Cannot happen without destructive confirmation | Error remains visible | Keychain identity and server balances are retained |

## Cross-cutting accessibility states

- Dynamic Type uses semantic styles and vertical reflow rather than scale factors for critical content.
- Accessibility text sizes replace dense horizontal groups with vertical actions.
- Every non-obvious symbol has a visible label or accessibility label.
- Interactive targets are at least 44 points.
- Increased Contrast relies on semantic system backgrounds/separators.
- Differentiate Without Color keeps icons and labels for success, warning, and error.
- Reduce Motion removes decorative transitions while retaining state changes.
- VoiceOver order follows identity -> document context -> research -> sources -> composer.
