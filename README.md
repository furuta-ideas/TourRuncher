# TourRuncher

柏の葉スマートシティツアーズのスタッフ向けHTML5 Webアプリ。

## 起動

Node.js 22以降。外部npm依存なし。

1. `.env.example`を`.env`にコピー。
2. `NOTION_TOKEN`を設定。`APP_PASSWORD`は`2026`。本番では`SESSION_SECRET`に十分長いランダムな文字列を設定。
3. NotionのインテグレーションにPlaybookとツアー一覧の読み取り権限を付与。
4. `npm start`で起動し、`http://localhost:3000`を開く。

APIキー、サービスのID・パスワード、案件情報、連絡先をGitHubへ保存しない。`.env`はgit管理対象外。

## GitHubから自動公開（Render）

1. [Render Blueprintを作成](https://dashboard.render.com/select-repo?type=blueprint)し、`furuta-ideas/TourRuncher`を選択。
2. `render.yaml`を読み込み、`NOTION_TOKEN`と`APP_PASSWORD`（`2026`）を秘密環境変数として設定。`SESSION_SECRET`は自動生成。
3. 初回デプロイ成功後にRenderが発行したHTTPS URLをスタッフへ共有。
4. 以降はmainへのpush → GitHub Actionsで検証 → 成功後にRenderで自動デプロイ。

初回のRenderアカウント連携とNotionの接続許可は管理者が実施する。GitHub Pages単体ではサーバー認証とNotion APIキーの保護ができないため、Webサービスとして配信する。無料プランには待機時間・上限がある。運用要件に応じてRender側で選択する。

## 挙動

- オープニング画像の読み込み後、5秒表示してフェードアウト。ログイン後にタブを表示。
- 起動ごとにパスワード入力。認証は署名付きHttpOnlyセッションCookie。本番はSecure Cookie。APIも認証必須。
- Notion情報はログイン時に取得し、更新ボタンなし。案件の本文は選択時に取得し、起動中はメモリへ保持。
- 日付は案件名の`yyyymmdd`から取得。日本時間の本日→最も近い未来→直近の過去の順に初期選択。同日の案件は`時間枠`の最も早い開始時刻（全角・半角対応）を優先。日付のない案件は一覧対象外。
- 上に未来、下に過去。3件分のリストをタッチ・ホイール・スクロールバーで動かすと中央の案件が選択される。
- Playbookのトグル、表、画像、添付ファイル、同期ブロックを表示。添付ファイルURLはNotionが発行する期限付きURLなので、長時間経過後は起動し直す。
- FAQは検索のたびに既存FAQアプリのHTMLから`FAQ_DB`をJSONとして読み込み。データを複製・固定化せず、マスター公開後の内容を参照。マスターの構造変更時はエラーを表示し、古いデータへ黙って切り替えない。
- FAQ検索は日本語／英語、複数キーワードAND検索。結果は4件ずつ表示。
- 画面の言語切り替えはFAQのみ。英訳がない回答は日本語を表示。
- パスワード認証はアプリへの共有アクセス用。公開リポジトリ自体に機密データは含まない。

## 検証

`npm test`：日付と時間枠の優先順位、FAQマスター形式・日英検索、未認証API拒否、Cookie改ざん拒否、秘密ファイル非公開を確認。

Notion API連携と本番画面は、有効なNOTION_TOKENを設定して確認する。
