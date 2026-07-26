# Notionブログ自動化

## 運用

- 月曜 09:00（日本時間）: 「会議・コンテンツログ」と「判断ライブラリ」を参照し、記事ドラフトDBへ1本を「要レビュー」で作成
- 川原が内容を確認・修正し、ステータスを「承認」に変更
- 水曜 09:00（日本時間）: 承認済みのうち最も古い1本を `src/content/blog` に公開
- AstroのビルドとGitHubへのpushが成功した後だけ、Notionを「公開済」に変更
- 承認記事がなければ何もしない

GitHub Actionsの `workflow_dispatch` から手動実行もできます。

## 必要なGitHub Actions Secrets

| Secret | 内容 |
|---|---|
| `NOTION_TOKEN` | 3つのNotionデータソースを共有したNotion Integration token |
| `OPENAI_API_KEY` | 記事生成に使用するOpenAI API key |
| `NOTION_MEETING_LOG_DATA_SOURCE_ID` | 会議・コンテンツログのdata source ID |
| `NOTION_JUDGMENT_LIBRARY_DATA_SOURCE_ID` | 判断ライブラリのdata source ID |
| `NOTION_ARTICLE_DRAFT_DATA_SOURCE_ID` | 記事ドラフトDBのdata source ID |

任意でRepository Variable `OPENAI_MODEL` を設定できます。未設定時はスクリプト既定値を使用します。

## Notion側の前提

### 会議・コンテンツログ

- titleプロパティ
- `経営管理`を含むmulti-selectプロパティ（推奨名: `タグ`）
- ページ本文にNotta文字起こし

### 判断ライブラリ

- titleプロパティ
- ページ本文に川原の判断基準・考え方

### 記事ドラフト

必須:

- titleプロパティ
- `ステータス`（statusまたはselect）
  - `要レビュー`
  - `承認`
  - `公開済`

推奨:

- `生成日`（date）
- `元素材`（rich_text）
- `元素材URL`（url）
- `狙うキーワード`（multi_select）
- `スラッグ`（rich_text）
- `判断ライブラリ`（rich_text）
- `公開日`（date）
- `公開URL`（url）

推奨プロパティが存在する場合は自動入力し、存在しない場合も処理は継続します。

## 安全設計

- 1回につき記事案・公開とも1本
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
