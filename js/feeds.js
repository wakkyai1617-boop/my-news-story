/**
 * 取得対象のRSSフィード定義。
 * category: "politics" | "ai"
 * url: RSSフィードのURL（CORSプロキシ経由で取得する）
 *
 * フィードを増減したい場合はこの配列を編集するだけでよい。
 */
const FEEDS = [
  // --- 政治ニュース ---
  {
    name: "Google ニュース（政治）",
    category: "politics",
    url: "https://news.google.com/rss/search?q=" +
         encodeURIComponent("政治") + "&hl=ja&gl=JP&ceid=JP:ja",
  },
  {
    name: "NHK 政治",
    category: "politics",
    url: "https://www.nhk.or.jp/rss/news/cat4.xml",
  },

  // --- AI動向 ---
  {
    name: "Google ニュース（AI）",
    category: "ai",
    url: "https://news.google.com/rss/search?q=" +
         encodeURIComponent("AI 人工知能") + "&hl=ja&gl=JP&ceid=JP:ja",
  },
  {
    name: "ITmedia AI＋",
    category: "ai",
    url: "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml",
  },
];
