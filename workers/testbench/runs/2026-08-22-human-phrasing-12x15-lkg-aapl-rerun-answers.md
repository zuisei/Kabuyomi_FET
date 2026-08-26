# 2026-08-22-human-phrasing-12x15-lkg-aapl-rerun Answers

## Test Method

- Scope: prompt v2 smoke response test against the Kabuyomi test Worker.
- Base URL: https://kabuyomi-api-test.dznqjmctk7.workers.dev
- Run started at: 2026-08-22T14:08:05.126Z
- Tickers: AAPL, JPM, MA
- Rows: 36
- Questions: `testbench/questions/human-phrasing-12.jsonl`
- Company set: `inline:KABUYOMI_TESTBENCH_TICKERS`
- Question templates observed: 12
- Company tickers observed: 3
- Note: hidden internal chain-of-thought is not recorded. This report records observable test rationale, criteria, outputs, and diagnostics.

## Result Summary

- Response paths: deterministic=20, fallback=4, openai=12
- Fallback reasons: low_quality_answer=4, none=32
- Infra errors: none=36
- Source ID invalid rows: 0
- Quality rows: 36
- Quality fallback rate: 11.1%
- Quality Q03/Q04/Q06 fallback: 0
- Quality hard-intent fallback: 2
- Average latency: 3707 ms
- Max latency: AAPL-Q03 12418 ms

## Quality Gate Counters

- rawEnglishSurfaced: 0
- hybridEnglishJapaneseSurfaced: 0
- genericBusinessModelAnswers: 1
- genericRevenueBreakdownAnswers: 0
- misleadingRevenueDriverCauses: 0
- nonFinancialCashFlowBankLanguage: 0
- metricOnlyImportantIntentAnswers: 0
- durabilityFollowupLostPriorDriver: 0
- numericDisplaySuspicious: 0
- unsupportedDurabilityClassification: 0
- unsupportedRiskOrLiquidityConclusion: 0
- qualitySourceEvidenceWeak: 3
- fallbackTaxonomyIntentMismatch: 0
- fallbackKindNoneOnFallbackRows: 0

## Review Notes

- Treat `fallbackReason=low_quality_answer` rows as the first human-review targets.
- Deterministic rows are expected when the local deterministic answer path handles the question.
- A row with no fallback is not automatically perfect; review the full answer text below for wording and grounding quality.

## Quality Issue Examples

### genericBusinessModelAnswers

- JPM-Q01 JPM Q01 business_model (fallback/low_quality/answer_too_metric_only): 一言概要: JPMorgan Chaseは大手総合金融グループとして、顧客向けの銀行・資産運用・決済・市場取引など幅広い金融サービスで収益を得ています。 主な収益源: NII（市場部門を含む利子収入、預金残高拡大やカード決済の revolving 機能等を通じた利息収入）と、NIR（資産運用費用、投資銀行手数料、マーケット系収益、ペイメント関連料金など）を中心に構成されています。 注意点: 直近の経営陣による業績説明では市場環境の金利動

### q07HistoricalLookupMissing

- AAPL-Q07 AAPL Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、現金及び現金同等物は 455.7億ドル で、前年同期比 61.8%増 です。 ほかには、営業CFは 826.3億ドル で、前年同期比 53.3%増 です。 1年内返済予定の長期債務は 83.1億ドル で、前年同期比 39.1%減 です。 提出資料では、日本は iPhone、アジア太平洋は iPhone と サービスと説明しています。
- JPM-Q07 JPM Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、EPS（Basic）は 5.95ドル/株 で、前年同期比 17.1%増 です。ほかには、営業CFは -2,117.6億ドル で、前年同期比 15.9%増 です。 純利益は 164.9億ドル で、前年同期比 12.6%増 です。提出資料では、純利息収入は 市場業務の純利息収入増、預金残高増、カード事業のリボ残高増、金利低下の影響 が主な説明要因、非利息収入は 市場業務の非利息収入増、資産運用手数料増、決済手数料増、投資銀
- MA-Q07 MA Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、現金及び現金同等物は 112.9億ドル で、前年同期比 25.0%増 です。 ほかには、EPS（Basic）は 4.98ドル/株 で、前年同期比 22.1%増 です。 純利益は 43.9億ドル で、前年同期比 18.6%増 です。

### q07DistinctFilingSourcesMissing

- AAPL-Q07 AAPL Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、現金及び現金同等物は 455.7億ドル で、前年同期比 61.8%増 です。 ほかには、営業CFは 826.3億ドル で、前年同期比 53.3%増 です。 1年内返済予定の長期債務は 83.1億ドル で、前年同期比 39.1%減 です。 提出資料では、日本は iPhone、アジア太平洋は iPhone と サービスと説明しています。
- JPM-Q07 JPM Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、EPS（Basic）は 5.95ドル/株 で、前年同期比 17.1%増 です。ほかには、営業CFは -2,117.6億ドル で、前年同期比 15.9%増 です。 純利益は 164.9億ドル で、前年同期比 12.6%増 です。提出資料では、純利息収入は 市場業務の純利息収入増、預金残高増、カード事業のリボ残高増、金利低下の影響 が主な説明要因、非利息収入は 市場業務の非利息収入増、資産運用手数料増、決済手数料増、投資銀
- MA-Q07 MA Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、現金及び現金同等物は 112.9億ドル で、前年同期比 25.0%増 です。 ほかには、EPS（Basic）は 4.98ドル/株 で、前年同期比 22.1%増 です。 純利益は 43.9億ドル で、前年同期比 18.6%増 です。

### q07YoYMasquerade

- AAPL-Q07 AAPL Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、現金及び現金同等物は 455.7億ドル で、前年同期比 61.8%増 です。 ほかには、営業CFは 826.3億ドル で、前年同期比 53.3%増 です。 1年内返済予定の長期債務は 83.1億ドル で、前年同期比 39.1%減 です。 提出資料では、日本は iPhone、アジア太平洋は iPhone と サービスと説明しています。
- JPM-Q07 JPM Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、EPS（Basic）は 5.95ドル/株 で、前年同期比 17.1%増 です。ほかには、営業CFは -2,117.6億ドル で、前年同期比 15.9%増 です。 純利益は 164.9億ドル で、前年同期比 12.6%増 です。提出資料では、純利息収入は 市場業務の純利息収入増、預金残高増、カード事業のリボ残高増、金利低下の影響 が主な説明要因、非利息収入は 市場業務の非利息収入増、資産運用手数料増、決済手数料増、投資銀
- MA-Q07 MA Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、現金及び現金同等物は 112.9億ドル で、前年同期比 25.0%増 です。 ほかには、EPS（Basic）は 4.98ドル/株 で、前年同期比 22.1%増 です。 純利益は 43.9億ドル で、前年同期比 18.6%増 です。

### q07SourcePeriodMismatch

- AAPL-Q07 AAPL Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、現金及び現金同等物は 455.7億ドル で、前年同期比 61.8%増 です。 ほかには、営業CFは 826.3億ドル で、前年同期比 53.3%増 です。 1年内返済予定の長期債務は 83.1億ドル で、前年同期比 39.1%減 です。 提出資料では、日本は iPhone、アジア太平洋は iPhone と サービスと説明しています。
- JPM-Q07 JPM Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、EPS（Basic）は 5.95ドル/株 で、前年同期比 17.1%増 です。ほかには、営業CFは -2,117.6億ドル で、前年同期比 15.9%増 です。 純利益は 164.9億ドル で、前年同期比 12.6%増 です。提出資料では、純利息収入は 市場業務の純利息収入増、預金残高増、カード事業のリボ残高増、金利低下の影響 が主な説明要因、非利息収入は 市場業務の非利息収入増、資産運用手数料増、決済手数料増、投資銀
- MA-Q07 MA Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、現金及び現金同等物は 112.9億ドル で、前年同期比 25.0%増 です。 ほかには、EPS（Basic）は 4.98ドル/株 で、前年同期比 22.1%増 です。 純利益は 43.9億ドル で、前年同期比 18.6%増 です。

### q07TypedClaimMappingMissing

- AAPL-Q07 AAPL Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、現金及び現金同等物は 455.7億ドル で、前年同期比 61.8%増 です。 ほかには、営業CFは 826.3億ドル で、前年同期比 53.3%増 です。 1年内返済予定の長期債務は 83.1億ドル で、前年同期比 39.1%減 です。 提出資料では、日本は iPhone、アジア太平洋は iPhone と サービスと説明しています。
- MA-Q07 MA Q07 prior_filing_delta (deterministic/none/none): 数字で目立つのは、現金及び現金同等物は 112.9億ドル で、前年同期比 25.0%増 です。 ほかには、EPS（Basic）は 4.98ドル/株 で、前年同期比 22.1%増 です。 純利益は 43.9億ドル で、前年同期比 18.6%増 です。

### q03Q04Q06FinalEvidenceMissing

- MA-Q04 MA Q04 driver_durability_followup (deterministic/none/none): 提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。

### q05TypedMarginDirectionMissing

- AAPL-Q05 AAPL Q05 margin_driver (openai/none/none): 要因としては売上高の増加に対して営業利益の伸びが大きく、営業利益率の改善がみられる点が挙げられます。 一方、経営陣による業績説明では関税などの外部要因が業績に影響を与えうるリスクとして示されており、具体的な原価率変化の内訳は明示されていません。
- JPM-Q05 JPM Q05 margin_driver (openai/none/none): 注意点: 本情報はQ1 2026と前年同期の比較に基づくもので、期間が限られており、セグメント別の営業利益率や通年見通しの開示は本文に限定的です。

### q05CitedFactorMissing

- JPM-Q05 JPM Q05 margin_driver (openai/none/none): 注意点: 本情報はQ1 2026と前年同期の比較に基づくもので、期間が限られており、セグメント別の営業利益率や通年見通しの開示は本文に限定的です。
- MA-Q05 MA Q05 margin_driver (openai/none/none): 売上高は前年比で14.1%増の92.8億ドル、営業利益は前年比で17.0%増の55.9億ドル、純利益は前年比で18.6%増の43.9億ドルとなり、各指標が共に改善しています。営業利益率は約60.22%、純利益率は約47.30%となり、前年同期と比べて効率性が高まっています。 改善要因としては、売上高の増加とそれに伴う営業利益の伸びが、利益率の押し上げに寄与しています。

### q08CompletenessMissing

- AAPL-Q08 AAPL Q08 segment_driver (fallback/low_quality/revenue_breakdown_sources_missing): 売上高の増減は確認できますが、選択された資料だけでは会社固有の売上の柱までは特定できません。見るべき箇所は、事業別の実績表、製品・サービス別の売上表、地域別の実績表、MD&Aの売上説明です。分類名だけでは、どの事業が大きいか・どこが伸びたかまでは判断しません。
- JPM-Q08 JPM Q08 segment_driver (openai/none/none): 主な売上区分は Consumer & Community Banking、Commercial & Investment Bank、Asset & Wealth Management の3部門です。 変化としては、非利息収益（NIR）が伸び、Asset & Wealth Management および Consumer & Community Banking を中心に寄与拡大しています。 一方、Card income は減少（前年同期比小
- MA-Q08 MA Q08 segment_driver (fallback/low_quality/revenue_breakdown_sources_missing): 売上高の増減は確認できますが、選択された資料だけでは会社固有の売上の柱までは特定できません。見るべき箇所は、事業別の実績表、製品・サービス別の売上表、地域別の実績表、MD&Aの売上説明です。分類名だけでは、どの事業が大きいか・どこが伸びたかまでは判断しません。

### q08EvidenceMappingMissing

- AAPL-Q08 AAPL Q08 segment_driver (fallback/low_quality/revenue_breakdown_sources_missing): 売上高の増減は確認できますが、選択された資料だけでは会社固有の売上の柱までは特定できません。見るべき箇所は、事業別の実績表、製品・サービス別の売上表、地域別の実績表、MD&Aの売上説明です。分類名だけでは、どの事業が大きいか・どこが伸びたかまでは判断しません。
- JPM-Q08 JPM Q08 segment_driver (openai/none/none): 主な売上区分は Consumer & Community Banking、Commercial & Investment Bank、Asset & Wealth Management の3部門です。 変化としては、非利息収益（NIR）が伸び、Asset & Wealth Management および Consumer & Community Banking を中心に寄与拡大しています。 一方、Card income は減少（前年同期比小
- MA-Q08 MA Q08 segment_driver (fallback/low_quality/revenue_breakdown_sources_missing): 売上高の増減は確認できますが、選択された資料だけでは会社固有の売上の柱までは特定できません。見るべき箇所は、事業別の実績表、製品・サービス別の売上表、地域別の実績表、MD&Aの売上説明です。分類名だけでは、どの事業が大きいか・どこが伸びたかまでは判断しません。

### q09CompletenessMissing

- AAPL-Q09 AAPL Q09 cash_flow_quality (deterministic/none/none): 営業CFは 826.3億ドル で、前年同期比 53.3%増 です。前年差でも改善しています。 営業CFと同じ対象期間の純利益を確認できないため、両者の大小は比較しません。運転資本の増減内訳は、返却された根拠では確認できません。 設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
- JPM-Q09 JPM Q09 cash_flow_quality (deterministic/none/none): 営業CFは -2,117.6億ドル で、前年同期比 15.9%増 です。前年差では改善していますが、まだマイナスです。 同じ対象期間の純利益は 164.9億ドル です。純利益と営業CFの差は、貸出・預金や取引資産負債の増減を含むため、大小だけで利益の現金化を評価しません。 金融機関では、運転資本の代わりに貸出・預金・取引資産負債の増減を確認する必要があります。設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。 ただ
- MA-Q09 MA Q09 cash_flow_quality (deterministic/none/none): 営業CFは 67.7億ドル で、前年同期比 3.0%減 です。前年差では悪化していますが、金額はプラスです。 営業CFと同じ対象期間の純利益を確認できないため、両者の大小は比較しません。運転資本の増減内訳は、返却された根拠では確認できません。 設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。

### q09EvidenceMappingMissing

- AAPL-Q09 AAPL Q09 cash_flow_quality (deterministic/none/none): 営業CFは 826.3億ドル で、前年同期比 53.3%増 です。前年差でも改善しています。 営業CFと同じ対象期間の純利益を確認できないため、両者の大小は比較しません。運転資本の増減内訳は、返却された根拠では確認できません。 設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
- JPM-Q09 JPM Q09 cash_flow_quality (deterministic/none/none): 営業CFは -2,117.6億ドル で、前年同期比 15.9%増 です。前年差では改善していますが、まだマイナスです。 同じ対象期間の純利益は 164.9億ドル です。純利益と営業CFの差は、貸出・預金や取引資産負債の増減を含むため、大小だけで利益の現金化を評価しません。 金融機関では、運転資本の代わりに貸出・預金・取引資産負債の増減を確認する必要があります。設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。 ただ
- MA-Q09 MA Q09 cash_flow_quality (deterministic/none/none): 営業CFは 67.7億ドル で、前年同期比 3.0%減 です。前年差では悪化していますが、金額はプラスです。 営業CFと同じ対象期間の純利益を確認できないため、両者の大小は比較しません。運転資本の増減内訳は、返却された根拠では確認できません。 設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。

### q10CompletenessMissing

- AAPL-Q10 AAPL Q10 liquidity_debt (deterministic/none/none): 現金及び現金同等物は455.7億ドルです。1年内返済予定の長期債務は83.1億ドルです。 長期債務（非流動）は744億ドルです。営業CFは826.3億ドルです。 同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。 コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可
- JPM-Q10 JPM Q10 liquidity_debt (deterministic/none/none): 営業CFは-2,117.6億ドルです。現金・1年内返済予定の長期債務・長期債務（非流動）を同じ時点で十分に比較できないため、資金繰りへの懸念は断定しません。 返却された根拠では手元資金・1年内返済予定の長期債務・長期債務（非流動）を確認できません。コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。 返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
- MA-Q10 MA Q10 liquidity_debt (deterministic/none/none): 現金及び現金同等物は112.9億ドルです。1年内返済予定の長期債務は24.6億ドルです。 長期債務（非流動）は221.8億ドルです。営業CFは67.7億ドルです。 同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。 コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用

### q10EvidenceMappingMissing

- AAPL-Q10 AAPL Q10 liquidity_debt (deterministic/none/none): 現金及び現金同等物は455.7億ドルです。1年内返済予定の長期債務は83.1億ドルです。 長期債務（非流動）は744億ドルです。営業CFは826.3億ドルです。 同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。 コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可
- JPM-Q10 JPM Q10 liquidity_debt (deterministic/none/none): 営業CFは-2,117.6億ドルです。現金・1年内返済予定の長期債務・長期債務（非流動）を同じ時点で十分に比較できないため、資金繰りへの懸念は断定しません。 返却された根拠では手元資金・1年内返済予定の長期債務・長期債務（非流動）を確認できません。コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。 返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
- MA-Q10 MA Q10 liquidity_debt (deterministic/none/none): 現金及び現金同等物は112.9億ドルです。1年内返済予定の長期債務は24.6億ドルです。 長期債務（非流動）は221.8億ドルです。営業CFは67.7億ドルです。 同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。 コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用

### qualitySourceEvidenceWeak

- JPM-Q01 JPM Q01 business_model (fallback/low_quality/answer_too_metric_only): 一言概要: JPMorgan Chaseは大手総合金融グループとして、顧客向けの銀行・資産運用・決済・市場取引など幅広い金融サービスで収益を得ています。 主な収益源: NII（市場部門を含む利子収入、預金残高拡大やカード決済の revolving 機能等を通じた利息収入）と、NIR（資産運用費用、投資銀行手数料、マーケット系収益、ペイメント関連料金など）を中心に構成されています。 注意点: 直近の経営陣による業績説明では市場環境の金利動
- MA-Q01 MA Q01 business_model (fallback/low_quality/answer_too_metric_only): 一言概要: Mastercardは決済ネットワークサービスを提供し、全社売上高として収益を得ています。 主な収益源: 全社売上高（売上高）が主要な収益指標です。 注意点: 規制動向や競争、技術変化、プライバシー・データ安全性への対応といった環境要因が収益に影響し得る点に注意が必要です。
- MA-Q04 MA Q04 driver_durability_followup (deterministic/none/none): 提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。

### qualityHardIntentFallback

- JPM-Q01 JPM Q01 business_model (fallback/low_quality/answer_too_metric_only): 一言概要: JPMorgan Chaseは大手総合金融グループとして、顧客向けの銀行・資産運用・決済・市場取引など幅広い金融サービスで収益を得ています。 主な収益源: NII（市場部門を含む利子収入、預金残高拡大やカード決済の revolving 機能等を通じた利息収入）と、NIR（資産運用費用、投資銀行手数料、マーケット系収益、ペイメント関連料金など）を中心に構成されています。 注意点: 直近の経営陣による業績説明では市場環境の金利動
- MA-Q01 MA Q01 business_model (fallback/low_quality/answer_too_metric_only): 一言概要: Mastercardは決済ネットワークサービスを提供し、全社売上高として収益を得ています。 主な収益源: 全社売上高（売上高）が主要な収益指標です。 注意点: 規制動向や競争、技術変化、プライバシー・データ安全性への対応といった環境要因が収益に影響し得る点に注意が必要です。

## Fallback Rows

- AAPL-Q08: low_quality_answer / low_quality / revenue_breakdown_sources_missing
- JPM-Q01: low_quality_answer / low_quality / answer_too_metric_only
- MA-Q01: low_quality_answer / low_quality / answer_too_metric_only
- MA-Q08: low_quality_answer / low_quality / revenue_breakdown_sources_missing

## All Answers

### AAPL-Q01

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 3324 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Apple Inc.は、iPhone、Mac、iPad、ウェアラブル、ホーム、アクセサリ、サービスを主な事業・製品群として持つ会社です。
```

Sources:

- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### AAPL-Q02

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 売上どうだった？伸びてる？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 335 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
売上高は 1,111.8億ドル で、前年同期比 16.6%増 です。 提出資料では、日本は iPhone、アジア太平洋は iPhone と サービスと説明しています。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### AAPL-Q03

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 売上のびた理由って何？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=9821, completion=1566, total=11387
- Latency: 12418 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: model_retry_used, retry_attempted, retry_wasted, revenue_drivers_deterministic_repair, numeric_alignment_repaired

Answer:

```text
売上高は 1,111.8億ドル で、前年同期比 16.6%増 です。 提出資料では、日本は iPhone、アジア太平洋は iPhone と サービスと説明しています。 寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### AAPL-Q04

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: それって今後も続く感じ？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 1163 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, source_gate_failed, durability_context_missing, hard_retrieval_used, q04_previous_answer_driver_candidate_repair, hard_intent_explicit_insufficiency_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、iPhone、サービス売上、製品カテゴリ成長 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、iPhone、サービス売上、製品カテゴリ成長、製品別売上 です。
```

Sources:

- CTX1: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- CTXF2: 10-Q Segment focus, filed 2026-05-01 (md_a)
- CTXF3: 10-Q Segment focus, filed 2026-05-01 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### AAPL-Q05

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 利益率なんか変わった？なんで？
- Intent: margin_driver
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=5764, completion=955, total=6719
- Latency: 6002 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: numeric_alignment_qualitative_recovery

Answer:

```text
要因としては売上高の増加に対して営業利益の伸びが大きく、営業利益率の改善がみられる点が挙げられます。 一方、経営陣による業績説明では関税などの外部要因が業績に影響を与えうるリスクとして示されており、具体的な原価率変化の内訳は明示されていません。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S5: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)

### AAPL-Q06

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: それ一時的なやつ？それともずっとこう？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 528 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, source_gate_failed, missing_margin_durability_context, hard_retrieval_used, q06_previous_answer_margin_candidate_repair, hard_intent_explicit_insufficiency_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、営業費用・原価、関税 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、営業費用・原価、関税 です。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S8: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)

### AAPL-Q07

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 前とくらべて何が変わった？
- Intent: prior_filing_delta
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 265 ms
- Source count: 8
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
数字で目立つのは、現金及び現金同等物は 455.7億ドル で、前年同期比 61.8%増 です。 ほかには、営業CFは 826.3億ドル で、前年同期比 53.3%増 です。 1年内返済予定の長期債務は 83.1億ドル で、前年同期比 39.1%減 です。 提出資料では、日本は iPhone、アジア太平洋は iPhone と サービスと説明しています。
```

Sources:

- S20: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S18: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S22: XBRL 1年内返済予定の長期債務 (LongTermDebtCurrent) (xbrl_metric)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S21: XBRL 現金及び現金同等物 comparison (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S19: XBRL 営業CF comparison (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S23: XBRL 1年内返済予定の長期債務 comparison (LongTermDebtCurrent) (xbrl_metric)

### AAPL-Q08

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: revenue_breakdown_sources_missing
- Runtime intent: segment_analysis
- Model: openai / unknown
- Tokens: prompt=4035, completion=448, total=4483
- Latency: 3953 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer

Answer:

```text
売上高の増減は確認できますが、選択された資料だけでは会社固有の売上の柱までは特定できません。見るべき箇所は、事業別の実績表、製品・サービス別の売上表、地域別の実績表、MD&Aの売上説明です。分類名だけでは、どの事業が大きいか・どこが伸びたかまでは判断しません。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### AAPL-Q09

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: ちゃんとキャッシュ稼げてる？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 279 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: q09_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery, numeric_alignment_repaired

Answer:

```text
営業CFは 826.3億ドル で、前年同期比 53.3%増 です。前年差でも改善しています。

営業CFと同じ対象期間の純利益を確認できないため、両者の大小は比較しません。運転資本の増減内訳は、返却された根拠では確認できません。

設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S18: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S19: XBRL 営業CF comparison (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### AAPL-Q10

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 借金やばくない？大丈夫？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=6370, completion=707, total=7077
- Latency: 4784 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: liquidity_conclusion_deterministic_recovery, q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は455.7億ドルです。1年内返済予定の長期債務は83.1億ドルです。

長期債務（非流動）は744億ドルです。営業CFは826.3億ドルです。

同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S20: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S22: XBRL 1年内返済予定の長期債務 (LongTermDebtCurrent) (xbrl_metric)
- S24: XBRL 長期債務（非流動） (LongTermDebtNoncurrent) (xbrl_metric)
- S18: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### AAPL-Q11

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: この決算でやばいとこある？
- Intent: risk_summary
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: risk_factors
- Model: openai / gpt-5-nano
- Tokens: prompt=3409, completion=1104, total=4513
- Latency: 7665 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
主要リスク: マクロ経済条件と関税などの措置が事業と業績に影響を及ぼす可能性、サプライチェーン・在庫の調達・生産に影響するリスク、景気・金利・為替の変動による需要の不確実性。
影響: 将来の業績に対する不確実性が高まり、収益性やキャッシュフローに影響を及ぼす可能性。
根拠: 経営陣による業績説明で「マクロ経済条件と関税等の措置が事業と結果に影響する可能性」が言及され、リスク要因としてこれらが挙げられている。
まだ数字に出ているか: 現在の開示は将来リスクとして表明されており、決算数字としての具体的な影響は公表された数値には現れていません。
```

Sources:

- S5: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)

### AAPL-Q12

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 次の決算、どこ見とけばいい？
- Intent: watch_points
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: unknown
- Model: openai / gpt-5-nano
- Tokens: prompt=5551, completion=1443, total=6994
- Latency: 10164 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
次の決算では、まず売上高と純利益の四半期比較と、営業利益率の水準を確認するのが基本です。 今期の売上高は1,111.8億ドル、純利益は295.8億ドルで、前年同期と比べていずれも増加しています（売上高は前年同期比約16.6%増、純利益は約19.4%増）。 また、輸入関税などの影響リスクが業績に及ぶ可能性がある点にも注意してください。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S12: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S13: XBRL 純利益 comparison (NetIncomeLoss) (xbrl_metric)
- CTX2: 10-Q Filing context, filed 2026-05-01 (md_a)

### JPM-Q01

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: answer_too_metric_only
- Runtime intent: business_overview
- Model: openai / unknown
- Tokens: prompt=4295, completion=675, total=4970
- Latency: 5170 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, raw_english_excerpt, driver_evidence_fragmentary, source_gate_false_positive, fallback_slot_incomplete

Answer:

```text
一言概要: JPMorgan Chaseは大手総合金融グループとして、顧客向けの銀行・資産運用・決済・市場取引など幅広い金融サービスで収益を得ています。

主な収益源: NII（市場部門を含む利子収入、預金残高拡大やカード決済の revolving 機能等を通じた利息収入）と、NIR（資産運用費用、投資銀行手数料、マーケット系収益、ペイメント関連料金など）を中心に構成されています。

注意点: 直近の経営陣による業績説明では市場環境の金利動向や顧客行動がNII/NIRに影響を与える点が指摘されており、セグメント別の寄与や提供費用の再編にも留意が必要です。
```

Sources:

- CTXH1: 10-Q Business overview (MD&A opening), filed 2026-05-01 (md_a)
- CTX2: 10-Q Business overview context, filed 2026-05-01 (md_a)
- CTX3: 10-Q Business overview context, filed 2026-05-01 (md_a)

### JPM-Q02

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 売上どうだった？伸びてる？
- Intent: revenue_snapshot
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=3743, completion=563, total=4306
- Latency: 5145 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: source_gate_applied, numeric_alignment_qualitative_recovery

Answer:

```text
追加確認が必要な点として、各セグメントの寄与度や今後の金利動向が収益にどう影響するかの見通し情報が不足しています。
```

Sources:

- CTX1: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### JPM-Q03

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 売上のびた理由って何？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=3742, completion=803, total=4545
- Latency: 6170 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: source_gate_applied, revenue_driver_deterministic_recovery

Answer:

```text
純利息収入では、市場部門の純利息収入、預金残高、カード事業のリボルビング残高の増加が寄与し、金利低下の影響が一部を相殺しました。 非利息収入では、資産運用手数料、投資銀行手数料、市場関連収入、決済手数料の増加が寄与しました。 一方、前年に計上した買収関連利益が当期にはなかったことは相殺要因です。
```

Sources:

- CTX1: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### JPM-Q04

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: それって今後も続く感じ？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=3926, completion=642, total=4568
- Latency: 4898 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、決済額・処理件数・国際取引量、純利息収入、非利息収入・投資銀行・市場業務、買収影響 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、決済額・処理件数・国際取引量、純利息収入、非利息収入・投資銀行・市場業務、買収影響 です。
```

Sources:

- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- CTX3: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- CTX1: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- CTX2: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### JPM-Q05

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 利益率なんか変わった？なんで？
- Intent: margin_driver
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=3614, completion=934, total=4548
- Latency: 5559 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: numeric_alignment_qualitative_recovery

Answer:

```text
注意点: 本情報はQ1 2026と前年同期の比較に基づくもので、期間が限られており、セグメント別の営業利益率や通年見通しの開示は本文に限定的です。
```

Sources:

- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S5: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)

### JPM-Q06

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: それ一時的なやつ？それともずっとこう？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=3702, completion=592, total=4294
- Latency: 3485 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, margin_driver_deterministic_recovery

Answer:

```text
提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、減価償却費、人件費、訴訟費用・引当 です。次に見るべき指標は、減価償却費、人件費、訴訟費用・引当 です。
```

Sources:

- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)

### JPM-Q07

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 前とくらべて何が変わった？
- Intent: prior_filing_delta
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 271 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
数字で目立つのは、EPS（Basic）は 5.95ドル/株 で、前年同期比 17.1%増 です。ほかには、営業CFは -2,117.6億ドル で、前年同期比 15.9%増 です。

純利益は 164.9億ドル で、前年同期比 12.6%増 です。提出資料では、純利息収入は 市場業務の純利息収入増、預金残高増、カード事業のリボ残高増、金利低下の影響 が主な説明要因、非利息収入は 市場業務の非利息収入増、資産運用手数料増、決済手数料増、投資銀行手数料増 が主な説明要因と説明しています。
```

Sources:

- S11: XBRL EPS（Basic） (EarningsPerShareBasic) (xbrl_metric)
- S12: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### JPM-Q08

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: openai / gpt-5-nano
- Tokens: prompt=3836, completion=847, total=4683
- Latency: 4404 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
主な売上区分は Consumer & Community Banking、Commercial & Investment Bank、Asset & Wealth Management の3部門です。

変化としては、非利息収益（NIR）が伸び、Asset & Wealth Management および Consumer & Community Banking を中心に寄与拡大しています。

一方、Card income は減少（前年同期比小幅減）し、First Republic関連の特別利益の不在が Other income に影響しています。この資料だけでは、部門別の金額内訳やどの部門が最も大きく寄与しているかの具体値は分かりません。
```

Sources:

- CTX3: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- CTX2: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)

### JPM-Q09

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: ちゃんとキャッシュ稼げてる？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 414 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: q09_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
営業CFは -2,117.6億ドル で、前年同期比 15.9%増 です。前年差では改善していますが、まだマイナスです。

同じ対象期間の純利益は 164.9億ドル です。純利益と営業CFの差は、貸出・預金や取引資産負債の増減を含むため、大小だけで利益の現金化を評価しません。

金融機関では、運転資本の代わりに貸出・預金・取引資産負債の増減を確認する必要があります。設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。

ただし金融機関の営業CFは、貸出・預金・取引資産負債の増減で大きく動くため、一般事業会社のように単純な本業の現金創出力とは見ません。預金、貸出、信用損失、流動性の説明と合わせて見る必要があります。
```

Sources:

- S12: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)

### JPM-Q10

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 借金やばくない？大丈夫？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=4214, completion=1083, total=5297
- Latency: 6788 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: liquidity_conclusion_deterministic_recovery, q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
営業CFは-2,117.6億ドルです。現金・1年内返済予定の長期債務・長期債務（非流動）を同じ時点で十分に比較できないため、資金繰りへの懸念は断定しません。

返却された根拠では手元資金・1年内返済予定の長期債務・長期債務（非流動）を確認できません。コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。

返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S12: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### JPM-Q11

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: この決算でやばいとこある？
- Intent: risk_summary
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: risk_factors
- Model: openai / gpt-5-nano
- Tokens: prompt=3182, completion=892, total=4074
- Latency: 7558 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
主要リスク3つ: 景気・金利・為替リスク、規制・独禁法リスク、競争激化リスク。影響として、これらは利益水準や貸出・資本配分、収益性に影響を与える可能性がある。

根拠として、10-Qのリスク要因開示（Item 1A）およびリスク管理の解説が挙げられており、該当リスクカテゴリが列挙されている。まだ数字としての影響額は示されていないが、定性的なリスク開示は存在する。
```

Sources:

- S8: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)

### JPM-Q12

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 次の決算、どこ見とけばいい？
- Intent: watch_points
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: unknown
- Model: openai / gpt-5-nano
- Tokens: prompt=3384, completion=464, total=3848
- Latency: 3318 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: numeric_alignment_qualitative_recovery

Answer:

```text
次の決算で注目すべきは、純利益の動向と収益・費用の推移です。 合わせてROE/ROTCE、LCR、CET1などの指標と資本・流動性の状況を確認すると良いです。 最も直接的な evidenceは、Q1の純利益と収益・費用の水準および各種比率です。
```

Sources:

- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- CTX1: 10-Q Filing context, filed 2026-05-01 (md_a)
- CTX2: 10-Q Filing context, filed 2026-05-01 (md_a)

### MA-Q01

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: answer_too_metric_only
- Runtime intent: business_overview
- Model: openai / unknown
- Tokens: prompt=4028, completion=920, total=4948
- Latency: 7520 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, fallback_slot_incomplete, hard_source_asset_missing_segment_results

Answer:

```text
一言概要: Mastercardは決済ネットワークサービスを提供し、全社売上高として収益を得ています。
主な収益源: 全社売上高（売上高）が主要な収益指標です。
注意点: 規制動向や競争、技術変化、プライバシー・データ安全性への対応といった環境要因が収益に影響し得る点に注意が必要です。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- CTXH1: 10-Q Business overview (MD&A opening), filed 2026-07-30 (md_a)

### MA-Q02

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: 売上どうだった？伸びてる？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 444 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 92.8億ドル で、前年同期比 14.1%増 です。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)

### MA-Q03

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: 売上のびた理由って何？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 383 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: hard_retrieval_used, hard_source_asset_missing_segment_results, revenue_drivers_deterministic_repair

Answer:

```text
売上高は 92.8億ドル で、前年同期比 14.1%増 です。 選択された提出資料では売上の増減は確認できますが、価格・数量・事業別のどれが全社売上の主因かを結び付ける説明は確認できません。 選択資料で明示された範囲を超えて、主因は断定しません。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)

### MA-Q04

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: それって今後も続く感じ？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 262 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, source_gate_failed, durability_context_missing, hard_retrieval_used, hard_source_asset_missing_segment_results, q04_previous_answer_driver_candidate_repair

Answer:

```text
提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)

### MA-Q05

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: 利益率なんか変わった？なんで？
- Intent: margin_driver
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=5458, completion=636, total=6094
- Latency: 4070 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
売上高は前年比で14.1%増の92.8億ドル、営業利益は前年比で17.0%増の55.9億ドル、純利益は前年比で18.6%増の43.9億ドルとなり、各指標が共に改善しています。営業利益率は約60.22%、純利益率は約47.30%となり、前年同期と比べて効率性が高まっています。

改善要因としては、売上高の増加とそれに伴う営業利益の伸びが、利益率の押し上げに寄与しています。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S11: XBRL 純利益 (ProfitLoss) (xbrl_metric)
- S13: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)

### MA-Q06

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: それ一時的なやつ？それともずっとこう？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 350 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, hard_retrieval_used, hard_source_asset_missing_segment_results, margin_snapshot_deterministic_repair, margin_driver_deterministic_recovery

Answer:

```text
提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、営業費用・原価、為替、訴訟費用・引当 です。次に見るべき指標は、営業費用・原価、為替、訴訟費用・引当 です。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S13: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S11: XBRL 純利益 (ProfitLoss) (xbrl_metric)
- S5: 10-Q Margin and profitability discussion, filed 2026-07-30 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-07-30 (md_a)
- S8: 10-Q Margin and profitability discussion, filed 2026-07-30 (md_a)

### MA-Q07

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: 前とくらべて何が変わった？
- Intent: prior_filing_delta
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 353 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
数字で目立つのは、現金及び現金同等物は 112.9億ドル で、前年同期比 25.0%増 です。 ほかには、EPS（Basic）は 4.98ドル/株 で、前年同期比 22.1%増 です。 純利益は 43.9億ドル で、前年同期比 18.6%増 です。
```

Sources:

- S15: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S12: XBRL EPS（Basic） (EarningsPerShareBasic) (xbrl_metric)
- S11: XBRL 純利益 (ProfitLoss) (xbrl_metric)
- S16: XBRL 現金及び現金同等物 comparison (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)

### MA-Q08

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: revenue_breakdown_sources_missing
- Runtime intent: segment_analysis
- Model: openai / unknown
- Tokens: prompt=3316, completion=408, total=3724
- Latency: 2717 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer

Answer:

```text
売上高の増減は確認できますが、選択された資料だけでは会社固有の売上の柱までは特定できません。見るべき箇所は、事業別の実績表、製品・サービス別の売上表、地域別の実績表、MD&Aの売上説明です。分類名だけでは、どの事業が大きいか・どこが伸びたかまでは判断しません。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)

### MA-Q09

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: ちゃんとキャッシュ稼げてる？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 438 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: q09_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
営業CFは 67.7億ドル で、前年同期比 3.0%減 です。前年差では悪化していますが、金額はプラスです。

営業CFと同じ対象期間の純利益を確認できないため、両者の大小は比較しません。運転資本の増減内訳は、返却された根拠では確認できません。

設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S14: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### MA-Q10

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: 借金やばくない？大丈夫？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=5754, completion=693, total=6447
- Latency: 3964 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は112.9億ドルです。1年内返済予定の長期債務は24.6億ドルです。

長期債務（非流動）は221.8億ドルです。営業CFは67.7億ドルです。

同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S15: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S17: XBRL 1年内返済予定の長期債務 (LongTermDebtCurrent) (xbrl_metric)
- S19: XBRL 長期債務（非流動） (LongTermDebtNoncurrent) (xbrl_metric)
- S14: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### MA-Q11

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: この決算でやばいとこある？
- Intent: risk_summary
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: risk_factors
- Model: openai / gpt-5-nano
- Tokens: prompt=3419, completion=765, total=4184
- Latency: 4846 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: raw_english_excerpt, final_answer_language_violation, answer_repaired_to_japanese, language_guard_source_backed_repair

Answer:

```text
確認できるリスクは、規制・コンプライアンス です。ただし、選択された抜粋だけでは重要度や影響額までは断定しません。追加で見るべき箇所は、リスク要因、MD&Aのリスク説明、業種固有リスクの説明です。
```

Sources:

- S5: 10-Q Margin and profitability discussion, filed 2026-07-30 (md_a)

### MA-Q12

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: 次の決算、どこ見とけばいい？
- Intent: watch_points
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: unknown
- Model: openai / gpt-5-nano
- Tokens: prompt=5173, completion=526, total=5699
- Latency: 4058 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: numeric_alignment_qualitative_recovery

Answer:

```text
次の決算では、売上高の成長率と各利益の推移を中心に見ると良いです。 これらの指標の四半期比較とドライバーの説明（製品/顧客動向、価格・構成比の変化、費用構造の変化）を経営陣による業績説明やセグメント情報で確認してください。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S11: XBRL 純利益 (ProfitLoss) (xbrl_metric)
- S13: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- CTX1: 10-Q Filing context, filed 2026-07-30 (md_a)
