# my-news-story

## プロジェクト概要
最新の政治ニュースとAI動向を収集・表示する専用サイト

## Current State
実装中（v1）。HTML/CSS/バニラJSの静的サイトを構築。RSS（Google ニュース / NHK / ITmedia）をCORSプロキシ経由で取得し、政治・AIのカテゴリ別に新着順表示する基本機能が完成。

## 技術スタック
- HTML / CSS / バニラJavaScript（ビルド不要の静的サイト）
- ニュース取得: RSSフィード（`DOMParser`でパース）
- CORS対策: 公開CORSプロキシをフォールバック（allorigins / corsproxy / thingproxy）

## Open Issues
- 公開CORSプロキシ依存のため、混雑・停止時に取得失敗の可能性 → 自前プロキシ（Cloudflare Workers 等）への置き換えを検討
- フィードの追加・重複記事の除去・キャッシュ（localStorage）など改善余地あり
