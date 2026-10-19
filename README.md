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

API：`https://tour-playbook-api.furuta-ideas.workers.dev`。新認証はCloudflare Accessの外部ID＋独立MFAと、SQLite-backed Durable Objectのセッションを使用する。Workers Freeで利用できる保存方式であり、無料枠超過時は処理が停止する。有料契約へ自動変更しない。

詳細な設定・切り替え手順は[認証運用](docs/authentication.md)。Cloudflare AccessのIdP、MFA必須ポリシー、発行元・audience、Notion ACL接続、管理者だけのACL編集権限を確認するまで、本番へ切り替えない。

Secretは`NOTION_TOKEN`、`SESSION_SECRET`。旧`APP_PASSWORD`は新コードでは使用しない。全データAPIで短期トークンと有効な個人セッション、最大60秒のNotion ACLを検証する。PagesからはCookieを使わずBearerで接続し、更新時はトップレベルの認証画面を経由する。

個人端末は最大30日、共有端末は12時間以内。期限は固定で、アクセスするたびに延長しない。CookieはHttpOnly・Secure・SameSite=Lax、トークンとセッションIDの保存はハッシュのみ。外部IdP・生体情報・パスキーの秘密鍵はアプリやNotionへ保存しない。

公開物は引き続きGitHub Pages。Cloudflareの`/auth/verify`だけをMFA必須のAccessアプリとして保護し、認証後はPKCEで束縛した60秒・一度限りのコードでPagesに戻る。APIはJWT署名検証済みの入口からのみ呼ぶ。

/health以外のデータ取得は認証が必要。HTTPはHTTPSへリダイレクト。Notionのデータ取得・ダウンロード元URLの発行は従来どおり分割する。ファイル本体はCloudflareで中継しない。

## 表示とキャッシュ

- 起動時に画像をフェードインして3秒表示、外部IDとMFAによる本人確認後にタブを表示。
- 日付と時間枠により本日最も早いツアー、なければ最も近い未来を初期表示。
- 直近10案件と事前準備は認証中のメモリだけにキャッシュ。旧localStorageは起動時に削除。ログアウト・失効・画面離脱時にキャッシュを破棄し、表示と並行して最新を確認する。
- 実施概要は正式見出し配下のみ取得し、Notionの文字色も再現する。
- FAQは検索のたびに公開マスターの最新データを取得する。カテゴリー検索、日本語・英語に対応。
- コンテンツは日本語・英語の表で表示し、Notionの分類とファイル名から座学・街歩き等へ振り分ける。ファイルのないセルは「ー」。表示言語を切り替えられる。
- ファイルのアイコンは認証後に取得した配布元URLから直接ダウンロード。Officeファイルは保存後に手動で開く。Mentimeterはブラウザーで開く。
- トラブル案内図はNotionの区切り線で分割し、3列で順に表示する。
- Cloudflare無料枠内で運用する。大容量ファイルを中継しないことでAPIのデータ転送を抑える。

## 検証

`npm test`で日付・時間枠、実施概要抽出、FAQ、キャッシュ上限、プロパティ順、画面非公開、Pagesの認証、トークン改ざん拒否を検証する。

APIキー、ログイン情報、案件・連絡先をGitへ保存しない。`.env`は管理対象外。
