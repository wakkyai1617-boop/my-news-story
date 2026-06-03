# my-news-story

最新の**政治ニュース**と**AI動向**を収集・表示する1ページのWebサイト。
HTML / CSS / バニラJavaScript のみで構成された静的サイトで、ビルドや
サーバーサイドのコードは不要。

## 特徴
- RSSフィードからニュースを自動取得して新着順に表示
- カテゴリ（すべて / 政治 / AI動向）でフィルタ
- 「更新」ボタンで再取得、相対時刻（◯分前）表示
- ダークテーマのレスポンシブデザイン

## 仕組み
ブラウザから直接RSSを取得するとCORSで弾かれるため、公開のCORSプロキシ
（allorigins / corsproxy / thingproxy）を順にフォールバックしながら取得し、
`DOMParser` でRSS/AtomをパースしてカードUIに描画している。

## 取得元フィード
`js/feeds.js` に定義。初期設定は以下。

| カテゴリ | フィード |
| --- | --- |
| 政治 | Google ニュース（"政治"検索）, NHK 政治 |
| AI動向 | Google ニュース（"AI 人工知能"検索）, ITmedia AI＋ |

フィードの追加・削除は `js/feeds.js` の `FEEDS` 配列を編集するだけ。

## ローカルでの起動
`fetch` を使うため `file://` ではなくHTTPサーバー経由で開く。

```bash
cd projects/my-news-story
python3 -m http.server 8000
# ブラウザで http://localhost:8000 を開く
```

## ファイル構成
```
my-news-story/
├── index.html          # ページ本体
├── css/style.css       # スタイル
├── js/feeds.js         # フィード定義（編集用）
├── js/app.js           # 取得・パース・描画ロジック
├── project-overview.md # プロジェクト概要
└── README.md
```

## 注意
- 公開CORSプロキシに依存しているため、プロキシ側の混雑・停止時は取得に失敗
  することがある（その場合は「更新」で再試行）。本番運用するなら自前の軽量
  プロキシ（Cloudflare Workers 等）に差し替えるのが望ましい。
- 各記事の本文は表示せず、見出し・要約・配信元リンクのみを表示する。
