# Tour PlayBook

柏の葉スマートシティツアーズのスタッフ向けHTML5 Webアプリ。

正式URL：https://furuta-ideas.github.io/TourRuncher/

## 公開構成

- GitHub Pages：画面、JavaScript、CSS、アイコン、オープニング画像を配信。
- Render（https://tourruncher.onrender.com）：認証、Notion API、FAQマスター取得のみ。ルートと画面・画像・スクリプトのURLは404を返す。
- GitHub Actions：mainへのpush時にテスト後、PagesとRenderへ自動公開。
- Pagesの公開物はpublicの指定ファイルとlib.mjsのみ。APIキーやNotionの情報は含めない。

## API

Node.js 22以降、外部npm依存なし。`.env.example`を`.env`へコピーしてNOTION_TOKEN、APP_PASSWORD、SESSION_SECRETを設定し、`npm start`でAPIを起動する。

ログインは正式Pagesオリジンからのみ受け付ける。認証済みAPIには12時間有効な署名付きBearerトークンが必要。トークンは画面のメモリにのみ保持し、Cookie・ローカルストレージには保存しない。CORSは https://furuta-ideas.github.io のみ許可する。

/healthはRenderの稼働確認用。APIはブラウザーから接続する必要があるためインターネットに到達可能な状態を維持するが、Webアプリの画面はRenderでは公開しない。

## 表示とキャッシュ

- 起動時に画像をフェードインして3秒表示、パスワード入力後にタブを表示。
- 日付と時間枠により本日最も早いツアー、なければ最も近い未来を初期表示。
- 直近表示10案件のプロパティ・実施概要と、役割分担・事前準備画面をブラウザーにキャッシュ。表示と並行して最新を確認し、変更時に更新する。
- 実施概要は正式見出し配下のみ取得し、Notionの文字色も再現する。
- FAQは検索のたびに公開マスターの最新データを取得する。カテゴリー検索、日本語・英語に対応。
- コンテンツは日本語・英語の表で表示し、Notionの分類とファイル名から座学・街歩き等へ振り分ける。ファイルのないセルは「ー」。表示言語を切り替えられる。
- ファイルのアイコンは認証済みAPI経由でダウンロード。Officeファイルは保存後に手動で開く。Mentimeterはブラウザーで開く。
- トラブル案内図はNotionの区切り線で分割し、3列で順に表示する。
- Renderの無料プランの休止後は、ログインや最新情報の取得に待機が発生する場合がある。

## 検証

`npm test`で日付・時間枠、実施概要抽出、FAQ、キャッシュ上限、プロパティ順、画面非公開、Pagesの認証、トークン改ざん拒否を検証する。

APIキー、ログイン情報、案件・連絡先をGitへ保存しない。`.env`は管理対象外。
