# Trusted Research Feed

## プロジェクト概要
政治・AI動向のニュースをRSSで収集し、ルールベースの信頼スコアと根拠説明を付与して表示するリサーチツール。
記事の保存・用途メモ管理・Research Board機能を備えたブラウザ完結型SPA。

## Current State（2026-06-27）
MVP 1〜6 すべて完成。GitHub Pages で公開済み。
公開URL: https://wakkyai1617-boop.github.io/my-news-story/

| MVP | 内容 | 状態 |
|-----|------|------|
| 1 | RSS収集・信頼スコア・保存機能・保存済みタブ | ✅ 完成 |
| 2 | 記事詳細モーダル | ✅ 完成 |
| 3 | 保存済み記事管理（用途・メモ・フィルター） | ✅ 完成 |
| 4 | Research Board（ボード作成・記事追加・ノート） | ✅ 完成 |
| 5 | 信頼スコア根拠表示・次に確認すべきこと | ✅ 完成 |
| 6 | 空状態UI・モーダル改善・リセット・README整備 | ✅ 完成 |

## 技術スタック
- HTML / CSS / バニラJavaScript（ビルド不要）
- RSS取得: DOMParser（RSS/Atom両対応）
- CORS対策: CORSプロキシフォールバック（allorigins → corsproxy.io → thingproxy）
- 保存: localStorage（`trf_saved_articles` / `trf_boards`）

## ファイル構成
```
index.html          # ページ本体（タブUI・モーダル）
css/style.css       # ダークテーマ（CSS変数）
js/feeds.js         # フィード定義
js/app.js           # メインロジック（約700行）
README.md
project-overview.md
```

## 設計メモ
- 信頼スコアはURLパターン・ソース名・日付鮮度からルールベースで算出（AI不使用）
- localStorage のキー: `trf_saved_articles`（記事）/ `trf_boards`（ボード）
- `normalizeSaved()` で旧データの後方互換を保証
- `enrichItem()` を再実行することで古い保存データでも trustReasons/nextChecks を補完
- イベントはすべて委譲（`.card` / `.modal-content` / `.board-view` 上でクローズストを使用）

## Open Issues
- 公開CORSプロキシ依存 → 自前プロキシ（Cloudflare Workers 等）検討
- フィード追加のUI（現在は feeds.js 直編集）
- 保存データのエクスポート（JSON/CSV）未実装
- ボード内記事の並べ替え（D&D）未実装
