# 全読み点検ログ Sat Aug 22 06:47:48 JST 2026

## quota.ts (1743行) 読了
- Q-1 [中] markPurchaseTransactionGranted だけ assertPurchaseProjectionUpdated が無い。
  他3つの mark* は全て changes<1 で 409 を投げる。ここだけ0行更新が黙って通り、
  DO(権威)は付与済みなのに D1 projection が pending/refunded のまま乖離しうる。
- Q-2 [低] buildEvalGrantOperationId が deviceKey を生で operation_id に入れ D1 に残す。
  eval-* 合成キー限定なので実害は小さいが、診断の非保持方針とはズレる。
- OK: readQuotaIdentity の優先順位(test/detached/account/entitlement/installation/local/device/ip)
- OK: mutateCreditUsage は insufficient_credits を例外化せず戻り値で返し consumeCredit が投げる
- OK: isLocalQuotaFallbackRequest は localhost/.test のみ。本番ホスト名では発火しない
- OK: 全ての mutate* が persistMonthlyGrant / persistCreditLedgerEntry を通す
- OK: persist 失敗時は enqueueCreditAuditRepair に積んで復旧可能にしている

## source-gate.ts 1-600 読了
- SG-1 [中・実測] normalizeSector は本番追跡30銘柄のうち **21銘柄が general** に落ちる。
  sector は呼び出し側(model-attempt.ts:71,89)で常に null が渡され、
  ハードコードされた17ティッカーの表 + companyName のキーワードだけで決まる。
  表の中身(AAPL/JPM/XOM/CAT/WMT/NET/KLAC/MS/ISRG/HAL/DE/TSLA/CL/VTR/FOXA/AEP/FCX)は
  60問ベンチのカンパニーセットと一致しており、**本番の追跡リスト向けに作られていない**。
  → ベンチ結果が本番に一般化しない構造的な理由。
- SG-2 [中・実測・バグ] **MA(Mastercard)が bank に誤分類される。**
  /bank|financial|jpmorgan|card/ が "mastercard" の中の "card" に部分一致するため。
  結果、baseMissingSourceTypes が「net interest income discussion」「provision for
  credit losses discussion」等を要求し、Mastercard の提出資料には存在しないので
  missingSourceTypes が常に非空 → sector_required_source_missing → source gate 失敗。
  同業の V(Visa)は general なので、**同じビジネスの2社で挙動が違う**。
  修正案: \bcard\b の語境界化(card revenue / card services は引き続き一致する)。
- OK: EMPTY_RESULT は sourceSufficient:true だが hardIntent が無いときのみ返る(ゲート非適用)
- OK: 不十分時は failureLabels に source_gate_failed を必ず足す

## source-gate.ts 600-1183 読了(全1183行 完了)
- SG-3 [低] isQ04MetricOrTableText(528-533) と isQ06MetricOrTableText(456-461) が
  完全に同一内容の重複関数。
- SG-4 [所見] ファイル全体が特定ベンチ設問に強く結合している
  (isQ04*/isQ06*/hasSpecificQ04*/isQ06Generic* 等、関数名に設問番号が入る)。
  SG-1 と併せて「ベンチ最適化であって一般化された門ではない」ことの裏付け。
- OK: isMetricSource / isBoilerplateSource の判定は妥当。hasRevenueDriverSignal を
  持つソースは boilerplate から除外される救済がある。

## response-finalizer.ts / final-answer-language.ts / deterministic.ts
- **RF-1 [高・実測・修正済]** inferDriverLabels の語境界欠落で
  KO/LLY の回答に「DRAM・NAND需要」が混入(/dram|nand/ が "dramatically" に一致)。
  asp\b→grasp、mix→mixture、bare "customer usage"→AWS も同類。commit 68c2b70 で修正。
- **RF-2 [高・未修正]** 企業固有のハードコード回答が本番経路にある。
  - buildWmtDurabilitySynthesis(2017): Walmart 向けに**完全な定数文字列**を返す。
    「既存店売上にECが寄与し…Walmart+の会員利用…」を filing の内容に関係なく主張。
    ラベルは q04_retail_durability_source_backed_repair(source_backed を名乗る)。
    実測でベンチ6件発火。数値を含まないため numeric-alignment では捕まらない。
  - buildJpmDurabilitySynthesis / buildGoogleDurabilitySynthesis も
    キーワードの有無で定型文を出す(内容自体は抽出物ではない)。
- **RF-3 [高・未修正]** deterministic.ts の TICKER_BUSINESS_OVERVIEWS(375) /
  TICKER_REVENUE_BREAKDOWNS(393) / issuerSignalLabels(601) は
  15ティッカー分の事業内容を**定数として保持**。
  buildTickerBusinessOverviewAnswer(354) は
  「{社名}は、{定数}で収益を得ている会社です。」を返し、
  **filing の実ソースをチップとして添付する**。
  → 出典チップ付きで、出典から来ていない記述が提示される。
    「すべての記述に、出典があります」という製品の看板に直接抵触。
  → 追跡30銘柄のうち表にあるのは約半数。残りは null で別経路に落ちるため
    企業によって回答の作られ方が変わる。
- RF-4 [低] finalResponsePath が sourceBackedHardFollowupAccepted 時に
  "openai" をハードコード(450行)。プロバイダが違っても openai と報告される。

- **RF-5 [高・実測・未修正]** sanitizeFinalUserFacingAnswer(約200個の無差別 regex 置換)が
  固有名詞を破壊する。実測(関数を直接呼んだ結果):
    "Emerging Markets の需要"          → "Emerging 市場業務 の需要"
    "the Pioneer transaction が完了"   → "the Pioneer 取引件数 が完了"
    "trading volume が増加"            → "trading 販売数量 が増加"
    "Total Liabilities は増加"         → "Total 負債 は増加"
    "This transaction also drove higher marketing expense."
                                       → "This 取引件数 また drove マーケティング費用の増加."
  原因は /\bMarkets?\b/→市場業務、/\btransactions?\b/→取引件数、/\bvolume\b/→販売数量 等の
  文脈無視の全置換。冪等ではある。
  コード自体に「壊してから個別に戻す」痕跡が多数あり、これが常態化している証拠:
    .replace(/Re資料 Industries/g, "資源産業")            ← source→資料 で壊れた CAT セグメント
    .replace(/Productivity\s+and\s+事業内容\s+Processes/) ← Business→事業内容 で壊れた MSFT
    .replace(/\bUniform Rental and Facility サービス/)    ← Services→サービス で壊れた Cintas
    .replace(/price-コスト/gi, "価格とコスト")            ← costs?→コスト で壊れた price-cost
  ベンチに出た固有名詞だけが個別に救済されており、**それ以外の企業は壊れたまま出る**。
- **RF-6 [中・未修正]** buildJpmRevenueDriverRecovery / cleanCatQ06MarginDurabilityAnswer など
  企業固有(JPM/CAT/WMT/GOOGL)の定型文・後処理が本番経路に多数。
  CAT 版はモデルの特定出力文字列を丸ごと別文に置換する実装。

## user-quota.ts (3105行) 完読
- UQ-1 [中] refundChat が **日次リセット境界をまたぐと別の日のカウンタを減らす**。
  返金は body.dateJST(返金時点のJST日付)の dailyRecord を減算するが、
  消費は消費時点の日付。23:59消費 → 00:01返金 で、当日分が1回無料になる。
  chatsUsed>0 ガードがあるので負にはならない。
  クレジット課金が有効な現状では legacy_chat 経路は主経路ではない。
- UQ-2 [低] pruneOldCreditOperations は list({limit:500}) で**辞書順先頭500件しか見ない**。
  operationId は時刻順ではないため、件数が増えると古い記録が恒久的に残りうる。
- UQ-3 [低] grantEvalCredit が purchasedRemaining に加算するため、
  paid-credit-liability レポートが eval 分を含んで過大計上になりうる(ledger の type では区別可能)。
- OK: 予約→コミット/解放の全経路が blockConcurrencyWhile + withStorageTransaction
- OK: restoreReservationAllocations は legacy_chat も正しく戻す(不変条件チェック付き)
- OK: 月次分は期間一致時のみ復元、期限切れ広告ロットは復元しない(仕様どおり)
- OK: 返金・返金取消は operationId 冪等 + purchaseRefundInvariantError で
      集計債務と個別債務の一致を毎回検証
- OK: principal migration は lock→export(digest)→apply(digest照合)→tombstone の
      各段が冪等で、対象側に既存 state があれば 409

## deterministic.ts 1-1100
- **D-1 [高・実測]** キュレーション表(TICKER_BUSINESS_OVERVIEWS /
  TICKER_REVENUE_BREAKDOWNS / issuerSignalLabels)の**キーが本番の追跡銘柄と合っていない**。
    本番30銘柄中 表に有り: 12 (NVDA AAPL MSFT AMZN TSLA WMT JPM LLY V XOM MU CAT)
                  表に無し: 18 (GOOG AVGO META BRK-B JNJ ORCL MA AMD COST NFLX BAC
                               ABBV CVX PLTR HD INTC PG CSCO)
    表にあるが本番で追跡していない: GOOGL, KO, DAL(ベンチの残骸)
  **キー不一致バグ: 表は "GOOGL" だが本番の追跡は "GOOG"。Alphabet は一生ヒットしない。**
- **D-2 [高]** summarizeSegmentPerformance は issuerSignalLabels[ticker] が無いと
  issuerSignals が空になり、**セグメント/地域の強弱を一切検出できない**。
  結果、表に無い18銘柄では常に
  「伸びた具体的なセグメント・地域・製品を特定できません」
  「減収・減益が明示されたセグメントや地域は特定できません」を返す。
  → 12銘柄では具体的に答え、18銘柄では常に「特定できません」という品質の崖。
- D-3 [所見] buildBusinessOverviewAnswer は **キュレーション定数を最優先**で返す
  (コメントに "Prefer its stable, reviewed overview" と明記)。
  実抽出(factualPack)は定数が無い場合の代替に降格している。
- OK: buildJpmRevenueDriversAnswer は各ドライバを実ソース本文のキーワード一致で
      個別に検証してから列挙する(finalizer 側の JPM 定型文より健全)
- OK: areCashFlowComparisonPeriodsCompatible は単位・期末・年度・四半期・期間長(±7日)
      まで照合してから純利益と営業CFを比較する

## 横断スイープ: RF-1 と同型の語境界欠落(全 src/ の add(label, /pattern/) を機械抽出)
候補35件を英単語コーパスで検証し、**意味が無関係なのに一致する4件**を特定。
いずれも final-answer-language.ts の航空会社(DAL)向けラベル群にあり、
DAL は本番の追跡銘柄に含まれていない = ベンチの残骸が他業種を汚染しうる。

- **FA-1 [中] `asm`(:512 販売数量・稼働率)** → "enthusiasm" "sarcasm" "spasm"
  "chasm" "plasma" に一致。plasma は半導体/ヘルスケアの提出資料に普通に出る。
- **FA-2 [中] `fare`(:510 価格・単価)** → "welfare" "warfare" "fanfare" に一致。
  welfare は従業員福利の記述で普通に出る。
- **FA-3 [低] `casm`(:505 営業費用 / :509 単位コスト)** → "sarcasm" に一致。
- **FA-4 [中] 裸の `mix`(:511 製品・顧客ミックス)** → "mixture" "mixed" に一致。
  "mixed results" は MD&A の定番表現。**既に修正した :405 とは別の関数**で、
  同じ誤りがもう一箇所残っていた。

(gpus/cancerous/cloudy/tariffs/fueling/demanding は同概念の語形変化なので無害)

## 企業固有ハードコードの分布(全 src/)
  deterministic.ts 46 / context-factual-pack.ts 25 / tracked-tickers.ts 12 /
  source-gate.ts 6 / gemini/fallback.ts 6 / response-finalizer.ts 2 /
  starter-tickers.ts 1 / final-answer-language.ts 1

## clients/gemini/fallback-known-business.ts (53行) 完読
- **KB-1 [中]** さらに別のキュレーション表。PH / CRWD / CEG / INTU の
  事業説明を**定数文字列**で返し、selectKnownBusinessSourceId が
  「最初の md_a チャンク」を出典として機械的に添付する。
  4銘柄とも本番の追跡リストに無い(ベンチ残骸)。RF-3 と同型。

- **FB-1 [高・実測] `isBankLike`(gemini/fallback.ts:~570)が事実上すべての企業で true。**
  判定は /(jpm|bank|financial|deposits?|loans?|...)/ を
  「ticker + 社名 + mdaText の先頭5000字」に当てるだけ。
  MD&A には "financial condition" / "financial statements" が必ず出るので常に一致する。
  **実測: 本番 v9 レコード 32件中 30件が true**(AAPL/KO/TSLA/LLY/XOM いずれも銀行扱い)。
  影響: missingSourceTypesForNonHard(intent="liquidity_debt") が銀行用リスト
  (deposits / credit quality / capital ratios)を返し、それが
  ユーザー向けの「確認すべき箇所」に出る。
  → **コカ・コーラの資金繰り回答が「預金」「信用品質」を確認せよと案内する。**
  なお同じ概念の isFinancialFilingForFinalizer(response-finalizer.ts)は
  明示ティッカー集合 + 社名のみの \b 付き正規表現で厳格。**同概念の実装が2つあり挙動が正反対。**
- **FB-2 [中・実測]** summarizeBusinessNarrativeEvidence(fallback.ts:~1095)と
  summarizeBusinessOverview(deterministic.ts:~700)の
  `add("がん検査・診断", /cancer|tumor|screening|diagnostic/i)` が汎用語に一致。
  実測で誤ラベルになる例: "wafer screening" "diagnostic tools" "credit screening"
  "screening of employees" "diagnostics software" "self-diagnostic"
  → 半導体やソフトウェア企業が「がん検査・診断を主な事業にする会社」と説明されうる。

## apple-store-server.ts / apple-signed-data.ts / history-store.ts / context-pack.ts / orchestrator.ts 読了
- **AP-1 [要判断]** 本番の `APPLE_APP_STORE_SERVER_ENVIRONMENT = "auto"` は
  `["production","sandbox"]` を意味し、**sandbox の署名付き取引が本番でも検証を通る**。
  `fetchSignedTransactionInfo` も production→sandbox の順で両方叩く。
  (これは「取引がどちらの環境か事前に判らない」ため Apple が推奨する形なので実装ミスではない)
  問題は**下流が environment で区別していないこと**:
  - `routes/credit-purchase-grant.ts` に environment の参照が1つも無い
    → sandbox 購入でも本番クレジットが付与される
  - `entitlements.ts` は environment を principal 導出に混ぜているので
    sandbox 購読が本番購読を乗っ取ることは無い(隔離はできている)が、プラン自体は付く
  影響範囲: 本番 App Store ビルドの StoreKit は production を使うため一般ユーザーは不可。
  **TestFlight ビルド(sandbox StoreKit)のユーザーが無償で本番クレジットを得られる。**
  意図的な運用ならこのままでよい。要判断。
- OK: apple-signed-data は Apple 公式 @apple/app-store-server-library と
      実物のルートCA(G2/G3)で検証。自前実装ではない。payload の environment も照合。
- OK: verifyCreditPurchaseWithApple はクライアント提供の JWS を信用せず、
      必ず Apple サーバから取り直して検証し、revocationDate も見る。
- OK: history-store.ts(1414) 期間種別・期間長(±45日)・符号跨ぎを検証し、
      出典に両方の filing が含まれることを確認してから回答を組む。問題なし。
- OK: context-pack.ts(1295) は既存チャンクの選択とMD&A本文からの窓切り出しのみ。捏造なし。
- OK: orchestrator.ts(791) は source_id 検証と経路選択。approvedSourceIds が
      モデル申告と食い違えば必ず修復経路へ落とす。
- **FA-5 [中] evidence-fallback.ts:driverLabelsForFallback にも同型が2件**
  `/average selling prices?|ASP/i` → 語境界が無く "grasp" に一致(平均販売価格)
  `/favorable mix|product mix|mix/i` → "mixed"/"mixture" に一致(製品ミックス)
  → 語境界欠落は計 **9箇所**(修正済4 + FA-1..4 + FA-5の2)
- OK: evidence-fallback は evidence slot(実ソース由来)からのみ文を組み、
      isUnsafeEvidenceText で生の英文断片・箇条書き記号・Item見出しを除外する
- OK: evidence-slots は isUnsafeDriverEvidence で driver を再フィルタし、
      落ちた数を failureLabels に出す(source_gate_false_positive まで立てる)
- OK: entitlements.ts は lookup 失敗時 fail-closed、5xx のみ猶予、
      environment 込みで principal を導出するので sandbox/production が混ざらない
- OK: installation-identity.ts は HMAC 由来 principal、bootstrap の
      ネットワーク鍵あたり3回制限、App Attest 鍵の重複登録を409で拒否、
      INSERT 競合時の再取得あり
- OK: admob-ssv.ts は Google の手順どおり(&signature= 前を署名対象、
      ECDSA P-256/SHA-256、verifier-keys.json から keyId 一致鍵)

## 【訂正】P2-1 の「SEC_FETCHER_SHARED_SECRET は死んだ鍵」は誤り
Worker は **`/internal/sec/*` を受信側でも公開**しており
(`src/routes/internal-sec-fetcher.ts`、`preMaintenanceRoutes` に登録)、
この鍵は `isAuthorizedSecFetcherRequest` の timing-safe 比較で使われている。
使われていないのは「送信側(SEC_FETCHER_BASE_URL 経由の外部呼び出し)」だけ。
Node 版サービスが本番経路に無いという結論自体は変わらない。

## routes/ 全19ファイル 読了(3160行)
- OK: internal-auth は timing-safe、未設定なら false(fail-closed)
- OK: test-automation-access / detached-access は
      **isDedicatedTestEnvironment(KABUYOMI_ENV と ENVIRONMENT の両方が "test")**
      を必須にしており、本番では絶対に有効化されない。
      DEV_DETACHED_ACCESS_DEVICE_KEYS も同様に test 限定。権限昇格経路なし。
- OK: apple-notifications-v2 は署名検証 → payload digest で重複判定 →
      5分のstale再取得 → 失敗時 status=failed。REFUND/REFUND_REVERSED を
      冪等に処理し、CONSUMPTION_REQUEST/ONE_TIME_CHARGE は付与しない
- OK: usage.ts の resolveBillingRuntimeCapabilities は Apple 系シークレットが
      揃っていない限り creditBillingEnabled を立てない(設定漏れで課金だけ有効化されない)
- 再確認: credit-purchase-grant.ts には environment の参照が無い(AP-1 のとおり)

## clients/ 読了
- **OA-1 [中・既知未修正の実体]** OpenAI の `finish_reason` は
  `parseOpenAIChatCompletionPayload` が取得し、`openai_invalid_response` の
  ログに載せるだけで**どこでも分岐に使っていない**。
  上限(chat 1800 / summary 2500)で切られると JSON が途中で終わり
  `parseJsonishText` が投げて `json_parse_failed` → フォールバック。
  再試行(model-retry)は**同じトークン上限**なので同じ所で切れる可能性が高い。
  → 引き継ぎの既知指摘「OpenAI 要約のトークン上限切れ再試行」の正体。
  `finishReason === "length"` を見て上限を上げて1回だけ再試行すれば閉じる。
- SEC-1 [所見] clients/sec.ts の METRIC_TAGS は 8指標 / 13タグ固定。
  別タグで報告する企業(銀行の InterestAndDividendIncomeOperating 等)は
  指標が取れず metrics_only 相当に落ちる。設計上の被覆範囲。
- OK: gemini/request.ts は chat/quote_translation にスキーマ無し再試行を持つ
      (summary は単発だが provider.ts 側に再試行が追加済み)
- OK: openai/request.ts はタイムアウトを AbortController + finally で解除、
      HTTP エラーを kind 分類して投げる
