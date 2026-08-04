# 経営管理ブログ自動化

## 運用

- 月曜・木曜 09:00（日本時間）: 「会議・コンテンツログ」と「判断ライブラリ」を参照し、記事案を1本作成
- 共通の「記事ドラフト」DBへ、`サイト＝経営管理`、`記事種別＝実務解説`、`ステータス＝要レビュー`で保存
- 川原が内容を確認・修正し、ステータスを「承認」に変更
- 火曜・金曜 09:00（日本時間）: `サイト＝経営管理`かつ`ステータス＝承認`の記事のうち、最も古い1本を公開
- AstroのビルドとGitHubへのpushが成功した後だけ、Notionを「公開済」に変更
- 承認記事がなければ何もしない

GitHub Actionsの `workflow_dispatch` から手動実行もできます。

## 必要なGitHub Actions Secrets

| Secret | 内容 |
|---|---|
| `NOTION_TOKEN` | 対象のNotionデータソースを共有したNotion Integration token |
| `OPENAI_API_KEY` | 記事生成に使用するOpenAI API key |
| `NOTION_MEETING_LOG_DATA_SOURCE_ID` | 会議・コンテンツログのdata source ID |
| `NOTION_JUDGMENT_LIBRARY_DATA_SOURCE_ID` | 判断ライブラリのdata source ID |
| `NOTION_ARTICLE_DRAFT_DATA_SOURCE_ID` | 共通の記事ドラフトDBのdata source ID |

任意でRepository Variable `OPENAI_MODEL` を設定できます。未設定時はスクリプト既定値を使用します。

## Notion側の前提

### 会議・コンテンツログ

- titleプロパティ
- `経営管理`を含むmulti-selectプロパティ（推奨名: `タグ`）
- ページ本文にNotta文字起こし

### 判断ライブラリ

- titleプロパティ
- ページ本文に川原の判断基準・考え方

### 共通の記事ドラフトDB

必須:

- `タイトル`（title）
- `サイト`（select）
  - `経営管理`
  - `補助金`
- `記事種別`（select）
  - `実務解説`
  - `制度更新`
  - `既存記事更新`
- `ステータス`（statusまたはselect）
  - `要レビュー`
  - `修正依頼`
  - `承認`
  - `公開済`
  - `見送り`
- `スラッグ`（rich_text）

使用する項目:

- `生成日`（date）
- `元素材`（rich_text）
- `元素材URL`（url）
- `狙うキーワード`（rich_textまたはmulti_select）
- `公開日`（date）
- `公開URL`（url）
- `レビューコメント`（rich_text）

## 投稿先の取り違え防止

- 記事生成時に`サイト＝経営管理`を必ず設定
- 記事公開時は`サイト＝経営管理`と`ステータス＝承認`の両方で抽出
- 公開先ドメインを`keieikanri.ciza.co.jp`に固定
- 設定された公開先が別ドメインの場合は処理を停止
- 1回の実行で公開する記事は最大1本

## その他の安全設計

- 未承認記事は公開しない
- slugは英小文字・数字・ハイフンだけ許可
- 同名ファイルがあれば上書きしない
- Astro build失敗時はpushしない
- push成功後だけNotionを「公開済」に更新
- 企業・人物を特定できる情報を匿名化するよう生成プロンプトで制約

## 手動実行

```bash
npm run blog:generate
npm run blog:publish
npm run build
npm run blog:finalize
```

ローカル実行では、GitHub Actionsと同じ環境変数を設定してください。`blog:publish` は記事ファイルと一時状態ファイルを作成します。ビルドとGitへの反映が成功した後にだけ `blog:finalize` を実行します。
