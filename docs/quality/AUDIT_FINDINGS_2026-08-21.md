# Kabuyomi 徹底点検 — 所見一覧(2026-08-21)

対象: Worker / iOS / sec-fetcher
状態: **2026-08-21 に全件修正済み。** 各項目の末尾に「対応」を追記した。
本番 config は同日 `13:20:25Z` に再発行済み(`production-config-refresh-20260821-v1`)。

## 検証のベースライン(全て実測)

| スイート | 結果 | 期待値 | 判定 |
|---|---|---|---|
| Worker `npm test` | **1150 passed / 0 failed**(79ファイル) | 1150 / 0 | 一致 |
| Worker `npm run typecheck` | **exit 0** | クリーン | 一致 |
| iOS `KabuyomiTests` | **204 passed / 0 failed** | 204 / 0 | 一致 |
| sec-fetcher `npm test` | **15 passed / 0 failed** | — | 緑 |

補足: `SUMMARY_FALLBACK_REGRESSION_2026-08-21.md` に記録された「App Store Server Notifications V2 の4件失敗」は
コミット `ece53a8` で解消済み。**現時点で失敗しているテストは1件も無い。**

つまり **「すでに起爆したテスト時限爆弾」は今は存在しない。** 以下は主に本番設定と製品コードの話。

---

# 深刻度順

## 🔴 P0-1. 本番 API が 2026-08-27 10:20 JST に全滅する(残り6日)

**これが今いちばん重い。提出どころではない。**

### 実測

```bash
cd workers && npx wrangler kv key get --binding KABUYOMI_CACHE --remote "remote_config"
```

本番 KV の実データ:

```json
{
  "version": "production-capabilities-restored-20260713-v1",
  "updatedAt": "2026-07-13T01:20:28.597Z",
  "maxStaleAgeSeconds": 3888000
}
```

`3,888,000 秒 = ちょうど45日`。

### 何が起きるか

`workers/src/lib/remote-config.ts:423`

```ts
function isEnvelopeFresh(envelope: StoredEnvelope, now: number): boolean {
  const age = now - Date.parse(envelope.updatedAt);
  return Number.isFinite(age) && age >= -5 * 60_000 && age <= envelope.maxStaleAgeSeconds * 1_000;
}
```

`2026-07-13T01:20:28.597Z + 45日 = **2026-08-27T01:20:28.597Z**`(= **2026-08-27 10:20 JST**)。
この瞬間に `isEnvelopeFresh` が false を返す。

**D1 の LKG フォールバックは救いにならない。** `persistLkg`(`remote-config.ts:387`)は
`stored_at` とは別に **エンベロープ自身の `updatedAt` をそのまま保存**し、`loadLkg` はその
`updated_at` を読んで同じ `isEnvelopeFresh` にかける。**KV と D1 は同じ瞬間に同時に期限切れになる。**

→ `SAFE_FAIL_CLOSED_CONFIG`(`remote-config.ts:110`)が選ばれる。その中身:

```ts
maintenanceMode: true,
chatEnabled: false,
creditBillingEnabled: false,
consumablePurchasesEnabled: false,
trackedTickers: []
```

→ `workers/src/index.ts:83`

```ts
if (config.maintenanceMode) {
  return unavailable("Kabuyomi is under maintenance");
}
```

`unavailable` = **HTTP 503**(`lib/response.ts:31`)。

### ユーザーに見えること

8/27 10:20 を過ぎた瞬間から、**課金中のユーザーを含む全ユーザー**が、
検索・企業表示・資料閲覧・チャット・引用翻訳・使用状況…**API を使う全機能で 503**。

生き残るのは `preMaintenanceRoutes`(`index.ts:41`)だけ。実際の中身は
法務ページ、identity bootstrap、アカウント復旧、Apple 通知V2、内部ルート群。
**ユーザーに見える機能はひとつも含まれていない。** アプリは事実上の全損。

正確には、`loadRemoteConfig` は 60秒のメモリキャッシュを持つ(`REMOTE_CONFIG_MEMORY_TTL_MS = 60_000`)ため、
切り替わりは isolate ごとに最大60秒遅れる。**8/27 01:20:28Z から遅くとも 01:21:28Z までに全滅する。**

しかも**誰も気づかない**: 通知は `remote_config_fail_closed` のログ1行だけ。
`npx wrangler tail` はこの環境で出力が取れない(引き継ぎ済みの既知事項)。

### 直し方

`maxStaleAgeSeconds` は**ペイロード側の値**なので、**コード変更ではなく本番 config の再発行**で直る。
新しい `updatedAt` で KV に `remote_config` を書き直せばよい。

### 付随して壊れていること

同じ config の `dailyRefreshEnabled: false`(実測)。引き継ぎの
「銘柄ユニバースの `snapshotUpdatedAt` が 2026-07-11 のまま」の答えがこれ。
cron は毎日走るが `index.ts:124` で即 return している。**事故ではなく設定でオフ。放置すれば古び続ける。**

---

## 🔴 P0-2. 全角数字・全角％の数値が「一切検証されずに」回答へ通る

**このアプリの売りは「すべての記述に出典がある」。その検証を素通りする入力形がある。**

### 実測(抽出器を直接叩いた)

`extractMaterialNumericClaims`(`workers/src/lib/chat/material-numeric-claims.ts:27`)は純粋関数なので、
実際に呼んで確かめた(`workers/test/` に一時プローブを置いて `npx vitest run`、確認後に削除)。

| 入力 | 抽出されたクレーム数 |
|---|---|
| `売上高は1,111.8億ドルでした。` | 1 ✅ |
| **`売上高は１１１１.８億ドルでした。`**(全角数字) | **0 ❌** |
| **`前年同期比+12.1％の増収です。`**(全角％) | **0 ❌** |
| **`前年同期比で12.1％増となりました。`** | **0 ❌** |
| `前年同期比＋12.1%の増収です。`(全角＋のみ) | 1 ✅ |

### なぜ致命的か

クレームが0件だと `validateNumericAlignment`(`numeric-alignment.ts:64`)は**即座に早期 return** する:

```ts
const claims = extractMaterialNumericClaims(input.answer);
if (claims.length === 0) {
  return { status: "not_applicable", answer: input.answer, ..., claimCount: 0 };
}
```

**実測で確認**: `answer: "売上高は１，１１１．８億ドル、前年同期比＋16.6％でした。"` を
`facts: []`(裏付けとなる事実がゼロ)で通すと → `status=not_applicable, claimCount=0`、
**answer は一字も変わらずそのまま返る**。

前回の所見で「通貨・百分率クレームはラベルが無ければ `blockedResolution` = fail-closed」と書いたが、
**それは「クレームとして抽出された後」の話**だった。抽出されなければ検証段階に到達しない。

### 失敗シナリオ

LLM が日本語出力で全角の `％` を使う(日本語文章では全角の方がむしろ自然で、
プロンプトは半角を強制していない)→ その百分率は**事実と一度も突き合わされない**
→ モデルが数字を捏造していても `blocked` にならない
→ **ユーザーには出典チップ付きの、検証済みに見える回答として表示される。**

### さらに悪い方向のバグ — 全角カンマ/ピリオドで数値が分裂する

| 入力 | 抽出結果(実測) |
|---|---|
| `売上高は1，111.8億ドルでした。` | `raw="1"` (値1) と **`raw="111.8億ドル"` (値 111.8億 = 実際の 1/10)** |
| `売上高は1,111．8億ドルでした。` | `raw="1,111"` (値1111) と **`raw="8億ドル"` (値 8億)** |

正しい `1,111.8億ドル` が **`111.8億ドル` として検証にかけられる**。
実際の事実は 1,111.8億なので一致せず → `blockedResolution` → `buildBlockedFallback` により
**正しかった回答が丸ごとテンプレートに差し替えられる**(誤ブロック)。

つまり全角文字は **「検証を素通りする」方向と「正しい回答を壊す」方向の両方**に振れる。

### 補足

`1株当たり利益は2.18ドル`(label=NONE)や `総資産は3,650億ドル`(label=NONE)は
**クレームとしては抽出され、ラベル無しで `blocked` になる** = fail-closed で正しい。
問題は**抽出そのものが0件になる**ケースに限られる。

---

## 🟠 P1-1. レガシー互換ブリッジは10日前に期限切れ済み(すでに発火)

### 実測

本番 config(上と同じ KV 読み出し):

```json
"legacyClientCompatibility": { "enabled": true, "expiresAt": "2026-08-11T14:14:00.000Z" }
```

**今日は 2026-08-21。10日前に過ぎている。**

### 何が起きるか

`legacy-client-compatibility.ts:88` — `now >= expiresAt` → `"expired"` → 認可しない。

呼び出し側 `workers/src/index.ts:203`:

```ts
const credential = await resolveInstallationCredential(request, env);
if (!credential) {
  if (authorizeLegacyClientCompatibilityRequest(request, url, env, config)) return;
  throw new AppError(401, "Installation credential is required");
}
```

→ インストール資格情報を持たないクライアントは
`/v1/usage`・`/v1/chat`・`/v1/company/*`・`/v1/watchlist/*`・`/v1/translate-quote` で **401**。

### 影響範囲(重要な限定)

`INSTALLATION_TOKEN_HMAC_KEY_V1` は本番に**設定済み**(`wrangler secret list` で確認)なので
503 分岐には落ちていない。また現行 iOS クライアントは `/v1/identity/bootstrap` を持つ
(`ios/Kabuyomi/Services/APIClient.swift:1290`)ので、**bootstrap できる版を使っている限り影響なし**。

被害を受けるのは **identity 導入前の App Store 版を使い続けているインストールのみ**。
累計DLが数件という規模を踏まえると実被害はほぼ無いと**推測**するが、
**該当者にはこの10日間ずっと 401 が返り続けており、アプリからは何の説明も出ていない**。

設計上は「期限が来たら消す」ものなので、**config から `enabled: false` にして意図を明示**するのが筋。
今は「期限切れの有効フラグ」が残っていて、状態が読み取りにくい。

---

## 🟠 P1-2. SEC レートリミットが上限ぴったりで、しかも再試行を数えていない

### 実測(コード)

`workers/src/durable/sec-rate-limiter.ts`

```ts
const WINDOW_MS = 1_000;
const MAX_REQUESTS = 10;
```

SEC の fair-access は **10 req/s 超過でIPブロック**。**マージンがゼロ。**

対して、**同じ役割の Node 版 `sec-fetcher/` は 8/s**(`src/sec-service.mjs:21`,
`rateLimitPerSecond` 既定 `8`)。**二つの実装で値が違う。**

### 数え漏れ

トークンは `waitForSecRateLimit`(`clients/sec-fetcher.ts:346`)で
**フェッチャ呼び出し1回につき1〜2個**しか消費されない:

```ts
const tokens = path === "/internal/sec/filing-assets" || path === "/internal/sec/prepared-filing" ? 2 : 1;
```

ところが実際に SEC を叩く `fetchWithRetry`(`lib/sec-fetcher-service.ts:379`)は
`retryCount`(既定2)まで再試行する = **1トークンで最大3回の SEC HTTP リクエスト**。
再試行はトークンを追加消費しない。

### 失敗シナリオ

SEC が 429/5xx を返し始める(混雑時に実際に起きる)→ 全リクエストが最大3回ずつ再試行される
→ **トークン予算を超えた分の SEC リクエストが発生**する。
再試行には `sleep(initialBackoffMs * (attempt + 1))` = 400ms → 800ms のバックオフがあるので
3回は 1.2秒以上に広がる。したがって「瞬間30/s」にはならないが、
**10/s のトークン予算に対して実リクエストが常に上振れする**構造になっている。
上限ぴったりの 10 と組み合わさるため、超過の余地が無い。

超過すると SEC が Worker の出口IPをブロック
→ **全ユーザーで企業の読み込み・資料取得が失敗**。回復は SEC 側のブロック解除待ちで、こちらから操作できない。
ユーザーには「SEC data is temporarily unavailable」(503)が出る。

### 併せて — DO が明示的なロックを使っていない(要確認 / **推測**)

`SecRateLimiterDO.take()` は `storage.get` → filter → `storage.put` の read-modify-write を
**`blockConcurrencyWhile` で包んでいない**。`user-quota.ts` の全変異経路が明示的に包んでいるのと対照的。

Cloudflare DO の input gate は、ストレージ操作の待機中は新しいイベントを配送しないため、
**この get→put 単体は暗黙に保護されている可能性が高い**。ただし飽和時に走る
`await sleep(waitFor)` は**ストレージ操作ではないので input gate が開く**。
「実際にレースするか」は**未検証**。ただし *暗黙のゲートに依存している* こと自体が、
同リポジトリの他の全変異経路と方針が食い違っており、脆い。

---

## 🟡 P2-1. `sec-fetcher/` は本番では動いていない(1,028行の二重実装)

### 実測

`wrangler.toml`: `SEC_FETCHER_BASE_URL = "cloudflare-internal"`
→ `clients/sec-fetcher.ts:159` で `fetchFromCloudflareInternalSecFetcher` に分岐
→ **`workers/src/lib/sec-fetcher-service.ts`(Worker内実装)が使われる。**

`SEC_FETCHER_BASE_URL` は `wrangler.toml` と `wrangler.test.toml` の**差分に現れなかった**
= 両環境とも `cloudflare-internal`。つまり **test でも本番でも Node 版は使われていない。**

つまり:

- **`sec-fetcher/` の Node サービスはどの環境の経路にも無い。** その15件のテストは何も守っていない
- HTTP リモート経路(25秒タイムアウト、`x-internal-token` 送出)も**本番では未使用**
- 本番シークレット `SEC_FETCHER_SHARED_SECRET` は**設定されているが送信されない**(死んだ鍵)

「片方だけ移行した」型そのもの。**二つの実装が既に乖離している証拠が P1-2 のレート値(8 vs 10)。**
Node 版を直しても本番は変わらないし、Worker 版を直しても Node 版のテストは緑のまま。

依頼にあった「sec-fetcher の認証・レート制限・タイムアウト」の観点で Node 版を読んだ結果:
**認証は正しい**(`timingSafeEqual` + 長さ事前チェック + 起動時必須 + ボディ読取前に検証、
`server.mjs:26` / `sec-service.mjs:280`)。そこに欠陥は無い。問題は**それが使われていないこと**。

---

## 🟡 P2-2. App Attest 検証失敗が `{ verified: false }` に潰れる(依頼で指摘済みの経路の実体)

`workers/src/lib/installation-identity.ts:657`

```ts
} catch (error) {
  logWarnEvent("app_attest_verification_rejected", {
    kind: input.kind,
    failureClass: builtInVerificationFailureClass(error)
  });
  return { verified: false };
}
```

**内蔵検証器の全例外がここで1つの `verified: false` に畳まれる。** 呼び出し側からは
「鍵が違う」「証明書チェーンが壊れている」「bundle version が許可外」「カウンタが巻き戻った」の
区別がつかない。ユーザーには何も出ず、ウェルカム50クレジット・購入・サブスク・リワードが黙って落ちる。

**ログにしか出ないので実質気づけない**(`wrangler tail` がこの環境で使えない以上、なおさら)。

補足: 外部検証器経路(`APP_ATTEST_VERIFIER_URL`)は逆に `AppError(503)` を投げる。
**同じ失敗が構成によって「静かに機能低下」と「明示的エラー」に分かれる**のも読みにくさの一因。

---

## 🟡 P2-3. bundle version の突き合わせは Worker デプロイ時にしか走らない

### 現状は無事

`wrangler.toml`: `APP_ATTEST_ALLOWED_BUNDLE_VERSIONS = "6,7"`
`ios/project.yml:11`: `CURRENT_PROJECT_VERSION: 6`

→ **7 への引き上げは安全。** 依頼で挙がっていた `"6"` 固定は既に手当て済み。

### 残っている穴(方向が限定される)

突き合わせは `workers/scripts/deploy-worker.mjs:55,61` にしか無い = **Worker をデプロイする時にしか照合しない。**

**失敗シナリオ**: v1.3 で `CURRENT_PROJECT_VERSION` を **8** に上げ、iOS だけ App Store に提出する
(Worker は触らないので deploy guard は走らない)
→ 審査通過・配信開始 → 新規インストールの attestation が `attestation_bundle_version_not_allowed` で拒否
→ P2-2 の経路で `verified: false` に潰れる
→ **新規ユーザーはウェルカム50クレジットを貰えず、購入もできない。エラーメッセージは出ない。**
→ 気づくのは「入れたけど何もできない」というレビューが付いてから。

つまり **iOS 側の提出フローには一切ゲートが無い。**

---

## 🟢 P3-1. 法務文書の更新日が三者三様(既知の未修正指摘の実体)

```
legal-site/public/index.html   : 2026-07-11
workers/src/routes/legal.ts    : 2026-04-26 と 2026-05-05
```

Worker がホストするフォールバック法務ページは静的サイトより**3か月古い改訂日**を表示する。
特商法・プライバシーの表示日が経路によって変わるのは、課金アプリとして望ましくない。

---

## 🟢 P3-2. `fallback-response.ts` に env 書き換えハックが残っている

`workers/src/lib/chat/fallback-response.ts:20`

```ts
const fallback = await generateChatAnswer(
  { ...env, GEMINI_API_KEY: undefined } as Env,
  ...
);
```

**現時点では正しく動く。** `clients/gemini.ts` の関数を**直接**呼んでおり、
プロバイダルータ(`clients/llm/provider.ts`)を経由しないため、鍵を消せば確実にローカル
フォールバックに落ちる(`clients/gemini.ts:31` 等)。

しかし**これは要約退行を起こしたのと同じ形のハック**。ingest 側は
`generateModelSummary(env, input, { forceFallback: true })` に直したのに、**ここだけ古い形が残っている。**
将来 `generateChatAnswer` をルータ経由に寄せた瞬間、この行は無言で
「ローカルフォールバック」から「OpenAI を呼ぶ」に意味が変わる。`forceFallback` に揃えるのが安全。

---

## 🟢 P3-3. 本番と test で `OPENAI_REASONING_EFFORT` が違う

```
wrangler.toml      : OPENAI_REASONING_EFFORT = "low"
wrangler.test.toml : OPENAI_REASONING_EFFORT = "minimal"
```

test 環境での回答品質検証が、**本番と違う推論設定**で行われている。
`OPENAI_PROMPT_VERSION` は両方 `"2"` で一致(アーキテクチャ文書の `1` という記述の方が古い)。

test には `GEMINI_API_KEY` が無い既知の非対称もあるため、
**「シミュレータで見た挙動 = 本番の挙動」と扱えない差が現時点で2つある。**

---

# 調べて「問題なし」と判断したもの(記録として)

推測で不安を残さないため、見て潰した範囲を明示する。

| 対象 | 判定 | 根拠 |
|---|---|---|
| **時限爆弾(テスト)** | 無し | 全ソースの未来日付リテラルを走査。`workers/test/remote-config.test.ts:323`(2026-08-26)と `installation-identity.test.ts:580`(2026-10-09)は **`vi.useFakeTimers` で固定済み**。`subscription-principal.test.ts:43` の 2026-09-01 は**ハッシュ入力**で実時刻と比較しない |
| **`user-quota.ts` 同時実行** | 問題なし | 全変異経路が `state.blockConcurrencyWhile()` + `withStorageTransaction()` で包まれている(`alarm` 959、`handleRequestExecution` 1025 等) |
| **クレジット配分の負残高** | 問題なし | `allocateCreditReservation`(2649)は 期限が早いバケット順 → welcome → purchased の順で `Math.min` 消費し、最後に `if (remaining !== 0) throw` の**不変条件チェック**がある |
| **数値の裏取り — 解決(resolution)段** | 堅い | 通貨・百分率クレームは**ラベルが付かない時点で `blockedResolution`**(`numeric-alignment.ts:352`, `396`)= fail-closed。**ただし抽出段に穴がある → P0-2 を参照** |
| **クレジット予約の返却・二重返却** | 問題なし | `expireReservation`(1554)冒頭に `if (reservation.status !== "reserved") return;` があり**冪等**。`restoreReservationAllocations`(1585)は月次分を `consumedMonthlyPeriodStart === creditState.periodStart` で**期間一致時のみ復元**(新期間へ持ち越さない)。期限切れの広告ロットは別バケットに変換されない |
| **インストール資格情報の90日失効** | 問題なし | `shouldRebootstrap`(`DeviceIdentityStore.swift:48`)が**失効14日前から先回りで再 bootstrap**。パース失敗時も `true` を返す(fail-safe 方向)。長期未起動で失効しても再 bootstrap 経路に入る |
| **`applyEmergencyOverrides` が P0-1 を回避しないか** | 回避しない | `remote-config.ts:367` は各フラグを **false 方向にしか倒さない**。`maintenanceMode` には触れない。P0-1 の連鎖に抜け道は無い |
| **StoreKit 失効・返金(iOS)** | 問題なし | `SubscriptionStore.swift:562` の `isActive` は `transaction.revocationDate != nil` と `expirationDate > Date()` の両方を見る。加えてサーバ側が権限の唯一の権威 |
| **sec-fetcher の認証** | 問題なし | 上記 P2-1 参照(実装は正しい。使われていないだけ) |

---

# 未検証(正直に)

- **D1 の LKG の実値**は読めていない。`wrangler d1 execute --remote` が
  `code: 7403 (not authorized)` で失敗した(`d1 list` は成功するので権限の一部欠落と思われる)。
  ただし P0-1 の結論は**コードから確定**する: `persistLkg` が保存するのは KV エンベロープの
  `updatedAt` そのものなので、LKG が KV より新しい `updatedAt` を持つことは**構造的にありえない**。
- **チャット回答の品質**(150問中112問がテンプレート)は今回の対象外。手を付けていない。
- `response-finalizer.ts`(3,498行)/ `deterministic.ts`(2,031行)/ `gemini/fallback.ts`(1,838行)は
  **呼び出し関係と numeric-alignment 連携のみ確認**。全行は読めていない。
- **P0-2 の実本番での発生頻度は未計測。** 抽出器に穴があることは実測で確定しているが、
  「本番の LLM が実際にどのくらいの割合で全角を出すか」は測っていない。
  本番の回答ログを全角 `％` / 全角数字で grep すれば頻度が出る。
- `numeric-alignment` の `requiredSourceIds`(引用に無い事実の出典ID)を
  `response-finalizer.ts` が**実際に出典チップへ追加しているか**は未追跡。
  追加していなければ「検証は通ったが出典が画面に出ない数値」が生じうる。
- `SecRateLimiterDO` の実レース有無(P1-2 末尾)。
- `CreditView.swift`(1,848行)は未読。

---

# 推奨する順番

1. **本番 config を再発行する(8/27 01:20 UTC まで)** — P0-1。**これだけは期限が動かせない**
2. 同時に `legacyClientCompatibility.enabled` を `false` に、`dailyRefreshEnabled` の要否を判断 — P1-1 / P0-1付随
3. **抽出器を全角正規化する** — P0-2。`extractMaterialNumericClaims` の入口で
   全角英数記号(`１`〜`９`, `％`, `，`, `．`)を半角へ NFKC 正規化すれば
   「素通り」と「誤分裂」の両方が同時に閉じる。**提出前にやる価値が最も高い**
4. SEC レートを 10 → 8 に下げ、再試行をトークンに数える — P1-2
5. iOS 提出フローに bundle version ゲートを足す(v1.3 で効く) — P2-3
6. 法務日付の統一 — P3-1

**注意**: 3 を入れると、これまで検証を素通りしていた回答が検証にかかるようになるため、
**`blocked` になる回答が増える(=テンプレートが増える)可能性がある**。
これは品質の低下ではなく、隠れていた問題が可視化されるということ。
P0-2 の修正は「回答品質 v2 対応」と併せて計画するのが筋。

---

# 対応(2026-08-21 実施)

## 本番 config の再発行(P0-1 / P1-1 / 日次更新)

`wrangler kv key put --binding KABUYOMI_CACHE --remote --preview false "remote_config"` で書き換え、
読み戻して検証済み。**変更したのは4項目だけで、他のキーは1つも動いていない**(書き込み前に差分検算)。

| | 変更前 | 変更後 |
|---|---|---|
| `version` | `production-capabilities-restored-20260713-v1` | `production-config-refresh-20260821-v1` |
| `updatedAt` | `2026-07-13T01:20:28.597Z` | `2026-08-21T13:20:25.774Z` |
| `legacyClientCompatibility.enabled` | `true`(期限切れのまま有効) | **`false`** |
| `dailyRefreshEnabled` | `false` | **`true`** |

`maxStaleAgeSeconds` は 3,888,000(45日)のまま据え置き。
**失効期限は 2026-08-27 10:20 JST → 2026-10-05 22:20 JST に移動**(残り44日)。

読み戻しで `creditBillingEnabled=true` / `consumablePurchasesEnabled=true` /
`maintenanceMode=false` / `extractorVersion=v9` / `promptVersion=v2` が
すべて変更前と同一であることを確認済み。

D1 の LKG は、次に config を読むリクエストで `persistLkg` が自動的に新しい
エンベロープへ更新する(コード上、KV が fresh なら必ず書く)。

**注意**: `dailyRefreshEnabled=true` にしたので cron(18:00 UTC = 03:00 JST)が動き出す。
下の SEC レート修正は**まだ本番にデプロイされていない**ので、Worker をデプロイする前に
最初の日次更新が走ると、旧レート(10/s)のまま実行される。
これは従来から本番が使っていた値なので新種のリスクではないが、**デプロイを先に済ませるのが望ましい**。

## コード修正

| 所見 | 対応 | ファイル |
|---|---|---|
| **P0-2** 全角数値が検証を素通り | 抽出器の入口で全角→半角を**長さを保ったまま**正規化。`start`/`end` が呼び出し元の元テキストにそのまま使えるので、修理値の差し込みは無傷。**全角括弧 `（）` と全角空白は意図的に対象外** — `長期債務（非流動）` のような通常の補足を負数括弧と誤認するため | `material-numeric-claims.ts` |
| **P1-2** SEC 再試行がトークン未消費 | `SecFetcherConfig` に `beforeAttempt` を追加し、`fetchWithRetry` が**再試行のたびに**呼ぶように。呼び出し側で1トークン消費する | `sec-fetcher-service.ts` / `clients/sec-fetcher.ts` |
| **P1-2** レート上限にマージン無し | `MAX_REQUESTS` 10 → **8**(Node 版と同値)。`take()` の read-modify-write を `blockConcurrencyWhile` で明示的に閉じ、待ち時間の算出も lock 内へ移動 | `durable/sec-rate-limiter.ts` |
| **P2-1** Node 版が本番経路に無い | 両 wrangler が `cloudflare-internal` である旨と、実際に動くのは Worker 内実装である旨をファイル先頭に明記 | `sec-fetcher/src/sec-service.mjs` |
| **P2-2** App Attest の失敗理由が消える | `AppAttestVerificationResult` に `failureClass` を追加し、403 の**内部詳細**として運ぶ。公開メッセージは変更なし(ユーザーに内部事情を出さない) | `installation-identity.ts` |
| **P2-3** iOS 提出にゲート無し | ビルド番号が本番許可リストに含まれるか検証するテストを追加(iOS 205件目)。同じ検査を `ci_post_clone.sh` にも入れ、Xcode Cloud のアーカイブでも止まるように | `AppModelTests.swift` / `ci_scripts/ci_post_clone.sh` |
| **P3-1** 法務の更新日ずれ | Worker のフォールバック4ページを静的サイトと同じ `2026-07-11` に統一 | `routes/legal.ts` |
| **P3-2** env 書き換えハック | `generateChatAnswer` に `forceFallback` を追加し、呼び出し側の `{ ...env, GEMINI_API_KEY: undefined }` を廃止。プロバイダが増えても意図が保たれる | `clients/gemini.ts` / `fallback-response.ts` |
| **P3-3** test/prod の推論設定差 | `wrangler.test.toml` の `OPENAI_REASONING_EFFORT` を `minimal` → `low` に。OpenAI 系の変数が本番と完全一致 | `wrangler.test.toml` |

## 検証

| スイート | 結果 |
|---|---|
| Worker `npm test` | **1154 passed / 0 failed**(1150 + 新規4件) |
| Worker `npm run typecheck` | **exit 0** |
| iOS `KabuyomiTests` | **205 passed / 0 failed**(204 + 新規1件) |
| sec-fetcher `npm test` | **15 passed / 0 failed** |

追加テスト `workers/test/full-width-numeric-claims.test.ts` は、
①長さが保たれてオフセットが元テキストに使えること ②以前0件だった4パターンが抽出されること
③全角カンマ/ピリオドで分裂しないこと ④裏付け0件の全角回答が `not_applicable` を素通りせず
`blocked` になること、の4点を固定している。

### 途中で見つけた回帰(記録)

最初の実装では全角括弧 `（）` と全角空白も正規化しており、**既存10件が失敗した**。
`長期債務（非流動）は100億ドルです。` の `（非流動）` が半角括弧に倒れ、
負数の括弧表記と解釈が競合したため。対象文字を数値構成文字だけに絞って解消。
**全角括弧を正規化しないのは仕様**であり、上記テストで固定してある。

## 未対応(意図的)

- **Worker 本番デプロイは未実施。** 上記コード修正は本番に反映されていない。
  `CURRENT_SHIPPING_TRUTH.md` の記載どおり、リリース証跡マニフェストが古い candidate に
  紐付いているため通常の deploy guard は失敗する見込み。デプロイは別途判断が要る
- `SecRateLimiterDO` の実レース有無は未検証のまま(`blockConcurrencyWhile` を入れたので
  仮にレースがあったとしても閉じている)
- `numeric-alignment` の `requiredSourceIds` が出典チップに反映されるかは未追跡
- チャット回答の品質(150問中112問がテンプレート)は対象外
- `CreditView.swift` は未読
