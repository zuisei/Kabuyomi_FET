# 本番チャットプロンプトの写し

**これは実行されるコードではない。OpenAI ダッシュボードにある本番プロンプトの写しである。**

`OPENAI_PROMPT_ID` が設定されているとき、`client.ts` は `invokeOpenAIDashboardPrompt` を通る。
その経路では `prompts.ts` の `buildChatPrompt` は**送られない**。本番の指示文は
OpenAI のダッシュボード側にあり、git には無かった。ここはその穴を塞ぐための写し。

## 中身

| ファイル | 中身 | 取得方法 |
|---|---|---|
| `pmpt_69f5f2f5.v2.developer.txt` | developer(システム)指示 7,567文字 | **バイト一致を SHA-256 で検証済** |
| `pmpt_69f5f2f5.v2.user-template.txt` | user メッセージのテンプレート | 画面表示からの転記(ハッシュ未検証) |

```
prompt id : pmpt_69f5f2f592b8819490c30cf43c4f0f770f3a1fc228661050
version   : 2  (ダッシュボード上で "default")
sha256    : 7b426ce7250fbc3a0e6dd0c156b9164c9bffb305f6d0ae57e16513fa89c53924
length    : 7567 文字 (末尾に改行なし)
取得日     : 2026-08-22
```

`workers/test/openai-production-prompt-snapshot.test.ts` が
`wrangler.toml` の id / version と、この写しのハッシュを固定している。

## ダッシュボードの設定は、実は使われていない

ダッシュボード側にはモデル設定も保存されている(`gpt-5-nano` / reasoning `minimal` /
verbosity `low` / text format `json_schema` `kabuyomi_chat_answer`)。
しかし `buildOpenAIResponsesPromptRequest`(`request.ts:535`)は
リクエストごとに **model / text.format / verbosity / reasoning.effort / max_output_tokens を
明示的に送っている**ため、これらはリポジトリ側が勝つ。

| 項目 | ダッシュボード | 実際に送られる値 | 勝つのは |
|---|---|---|---|
| model | `gpt-5-nano` | `OPENAI_CHAT_MODEL` = `gpt-5-nano` | リポジトリ(一致) |
| reasoning effort | `minimal` | `OPENAI_REASONING_EFFORT` = **`low`** | **リポジトリ(不一致)** |
| verbosity | `low` | `"low"`(ハードコード) | リポジトリ(一致) |
| text format | `json_schema` | `openAIChatResponseJsonSchema()` | リポジトリ |
| max output tokens | — | `OPENAI_MAX_COMPLETION_TOKENS` = 1800 | リポジトリ |

→ **ダッシュボードが実際に握っているのはプロンプトの文面だけ**である。
E-1 で「安全性の中核がダッシュボード側にある」と書いたが、正確には
**出力の形・モデル・トークン上限はリポジトリ側にあり、指示文だけがダッシュボード側**だった。

## この写しの限界(正直に)

テストは **ダッシュボードが変更されたことを検知できない**。
検知できるのは (a) `wrangler.toml` の id / version が写しとずれること、
(b) この写し自体が黙って編集されることの2つだけである。

ダッシュボードは、コミットもレビューもデプロイも無しに本番の回答挙動を変えられる。
それが構造的な問題であることは変わらない。この写しは
「本番で何が指示されているかを、リポジトリを読めば分かる」状態にするだけのものである。
定期的に取り直して差分を見ること。
