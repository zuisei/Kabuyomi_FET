# Kabuyomi v1.0.2 Account Status Privacy Fix Report

> **Historical release evidence — not current shipping authority.** This point-in-time report preserves prior findings and may describe deployments, capabilities, or release decisions that have since changed. Use `CURRENT_SHIPPING_TRUTH.md`, `FEATURE_PARITY_COMPATIBILITY_REPORT.md`, `RELEASE_GATE_STATE.json`, and `FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md` for current decisions.

## 1. Conclusion

The Credits / Account Status UI no longer exposes the raw production API base URL, Worker hostname, route names, or endpoint paths in the normal user-facing surface.

Release and TestFlight users now see account-relevant status only: connection state, environment label, plan, credit balances, sync timestamps, app version, and restore/sync controls.

## 2. Removed Internal Exposure

- Replaced raw `prod / https://...workers.dev` display with:
  - `接続状態: 正常 / 未確認 / エラー`
  - `環境: 本番 / テスト / カスタム`
- Removed route detail rows from Account Status display rows.
- Removed endpoint path display from billing route health rows.
- Kept device identity redacted as `端末ID末尾: …xxxxxx` only inside DEBUG diagnostics.
- Confirmed Account Status does not show full device keys, tokens, transaction IDs, or Apple signed payloads.

## 3. Release / TestFlight UI Behavior

Release/TestFlight Account Status shows only normal rows:

- `接続状態`
- `環境`
- `現在のプラン`
- `合計クレジット`
- `月額/初回分`
- `購入分`
- `広告/無料分`
- `次回更新`
- `最終利用同期`
- `最終購入同期`
- `App`

The diagnostic disclosure is compiled out with `#if DEBUG`, so Release/TestFlight builds do not show route health details, raw API URLs, device suffixes, or internal route labels from this sheet.

## 4. Debug-Only Diagnostics Behavior

DEBUG builds keep a separate `開発用診断` disclosure for development support.

Inside that disclosure:

- Device identity is still suffix-only.
- Billing route health is summarized as `正常` / `エラー`.
- Endpoint paths are not shown in the Account Status sheet.
- The raw API base URL remains limited to existing DEBUG-only developer settings, not the normal Credits / Account Status UI.

## 5. Screenshots Captured

Captured on iPhone 17 Pro simulator, iOS 26.4.1:

- `test-results/v1.0.2-account-status-privacy/credits_main_release.jpg`
- `test-results/v1.0.2-account-status-privacy/account_status_release.jpg`
- `test-results/v1.0.2-account-status-privacy/account_status_details_closed_release.jpg`
- `test-results/v1.0.2-account-status-privacy/account_status_details_open_not_available_release.jpg`

Screenshot inspection result:

- No `workers.dev` URL exposed in Release Account Status.
- No `/v1/...` endpoint paths exposed in Release Account Status.
- No full device key, transaction ID, token, or Apple signed payload exposed.
- Release has no Account Status diagnostics disclosure.

## 6. Tests / Commands Run

Commands run:

```sh
taskpolicy -b nice -n 10 xcodebuild build \
  -project ios/Kabuyomi.xcodeproj \
  -scheme Kabuyomi \
  -destination 'id=C6AD1211-DB18-4F10-8003-85D637B4F4C4' \
  CODE_SIGNING_ALLOWED=NO \
  -jobs 6
```

Result: passed.

```sh
taskpolicy -b nice -n 10 xcodebuild test \
  -project ios/Kabuyomi.xcodeproj \
  -scheme Kabuyomi \
  -destination 'id=C6AD1211-DB18-4F10-8003-85D637B4F4C4' \
  -parallel-testing-enabled NO \
  -jobs 6
```

Result: passed, 140 tests.

```sh
taskpolicy -b nice -n 10 xcodebuild build \
  -project ios/Kabuyomi.xcodeproj \
  -scheme Kabuyomi \
  -configuration Debug \
  -destination 'id=C6AD1211-DB18-4F10-8003-85D637B4F4C4' \
  CODE_SIGNING_ALLOWED=NO \
  -jobs 6
```

Result: passed.

```sh
git diff --check
```

Result: passed.

## 7. Remaining Risks

- Human TestFlight visual review still has to confirm the same Account Status privacy behavior on the distributed build.
- Existing DEBUG developer settings can still show the raw API base URL by design; this is acceptable only because that UI is compiled behind `#if DEBUG` and is not present in Release/TestFlight.
- The broader working tree still contains unrelated dirty UI/release changes from previous v1.0.2 polish work; this task did not commit or push.

## 8. releaseDecision

`ready-for-testflight-smoke`

The privacy issue in Credits / Account Status is fixed for Release/TestFlight UI. Proceed with TestFlight smoke after packaging the intended dirty changes into coherent commits.
