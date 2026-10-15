# Tour PlayBook

柏の葉スマートシティツアーズのスタッフ向けHTML5 Webアプリ。

正式URL：https://furuta-ideas.github.io/TourRuncher/

## 公開構成

- GitHub Pages：画面、JavaScript、CSS、アイコン、オープニング画像を配信。
- Cloudflare Workers（https://tour-playbook-api.furuta-ideas.workers.dev）：認証、Notion API、FAQマスター取得。ファイル本体は中継しない。
- GitHub Actions：mainへのpush時にテスト後、Pagesへ自動公開。APIコードの変更は`pnpm deploy:api`でCloudflareへ公開する。
- Render：旧API。停止状態を維持し、正式アプリから参照しない。
- Pagesの公開物はpublicの指定ファイルとlib.mjsのみ。APIキーやNotionの情報は含めない。

## API

### Cloudflare Workers

移行先API：`https://tour-playbook-api.furuta-ideas.workers.dev`。`wrangler.jsonc`と`worker.mjs`で、既存APIをCloudflare Workers上で実行する。支払いが必要なストレージやデータベースのバインディングは使用しない。

CloudflareのSecretに`NOTION_TOKEN`、`APP_PASSWORD`、`SESSION_SECRET`を設定する。トークンをGit、公開ファイル、GitHub Pagesへ保存しない。`wrangler deploy`でAPIを公開し、ログインとNotion接続を確認してから`public/app.js`の`apiBase`を移行先へ切り替える。

WorkersではPlaybookを`?section=content|ids|trouble|contacts|faq`で分割取得し、無料枠の1リクエスト当たりの外部呼び出し数を抑える。`DIRECT_DOWNLOADS=1`ではファイル本体を中継しない。認証済み`/api/material/:id?metadata=1`から短期間有効な配布元URLだけを取得し、ブラウザーが配布元へ直接アクセスする。配布元がブラウザーの直接取得を許可する場合は進捗表示付きで保存し、許可しない場合は配布元のリンクを表示する。

ローカル検証：`wrangler dev --local`。デプロイ用アカウントの認証：`wrangler login --device`。CLIの権限はアカウント参照とWorkersの作成・更新に限定する。Renderの設定は旧構成として保持するが、稼働・課金の再開は不要。

Node.js 22以降、外部npm依存なし。`.env.example`を`.env`へコピーしてNOTION_TOKEN、APP_PASSWORD、SESSION_SECRETを設定し、`npm start`でAPIを起動する。

ログインは正式Pagesオリジンからのみ受け付ける。認証済みAPIには12時間有効な署名付きBearerトークンが必要。トークンは画面のメモリにのみ保持し、Cookie・ローカルストレージには保存しない。CORSは https://furuta-ideas.github.io のみ許可する。

/healthはAPIの稼働確認用。APIはブラウザーから接続する必要があるためインターネットに到達可能な状態を維持するが、Webアプリの画面はGitHub Pagesのみで公開する。

## 表示とキャッシュ

- 起動時に画像をフェードインして3秒表示、パスワード入力後にタブを表示。
- 日付と時間枠により本日最も早いツアー、なければ最も近い未来を初期表示。
- 直近表示10案件のプロパティ・実施概要と、役割分担・事前準備画面をブラウザーにキャッシュ。表示と並行して最新を確認し、変更時に更新する。
- 実施概要は正式見出し配下のみ取得し、Notionの文字色も再現する。
- FAQは検索のたびに公開マスターの最新データを取得する。カテゴリー検索、日本語・英語に対応。
- コンテンツは日本語・英語の表で表示し、Notionの分類とファイル名から座学・街歩き等へ振り分ける。ファイルのないセルは「ー」。表示言語を切り替えられる。
- ファイルのアイコンは認証後に取得した配布元URLから直接ダウンロード。Officeファイルは保存後に手動で開く。Mentimeterはブラウザーで開く。
- トラブル案内図はNotionの区切り線で分割し、3列で順に表示する。
- Cloudflare無料枠内で運用する。大容量ファイルを中継しないことでAPIのデータ転送を抑える。

## 検証

`npm test`で日付・時間枠、実施概要抽出、FAQ、キャッシュ上限、プロパティ順、画面非公開、Pagesの認証、トークン改ざん拒否を検証する。

APIキー、ログイン情報、案件・連絡先をGitへ保存しない。`.env`は管理対象外。
