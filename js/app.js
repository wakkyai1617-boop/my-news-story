/**
 * my-news-story — フロントエンドのみで動くニュースアグリゲータ。
 *
 * RSSフィードはブラウザから直接取得するとCORSで弾かれるため、
 * 公開のCORSプロキシを順に試して取得する。取得したXMLは
 * DOMParser でパースし、カテゴリごとにカードとして描画する。
 */

// 取得に使うCORSプロキシ（先頭から順にフォールバック）。
// いずれも「URLを渡すと中身をそのまま返す」タイプのプロキシ。
const PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

const MAX_ITEMS_PER_FEED = 12;

const state = {
  items: [],
  category: "all",
  loading: false,
};

const el = {
  grid: document.getElementById("news-grid"),
  status: document.getElementById("status"),
  updated: document.getElementById("updated"),
  refresh: document.getElementById("refresh"),
  tabs: document.querySelectorAll(".tab"),
};

/* ---------- 取得 ---------- */

// プロキシを順に試しつつ、1フィードを取得して中身（テキスト）を返す。
async function fetchWithProxy(feedUrl) {
  let lastError;
  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy(feedUrl), { signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text && text.includes("<")) return text;
      throw new Error("空のレスポンス");
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("全プロキシで取得に失敗");
}

// RSS/Atom の XML 文字列を記事配列にパースする。
function parseFeed(xmlText, feed) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (doc.querySelector("parsererror")) return [];

  // RSS は <item>、Atom は <entry>
  const nodes = doc.querySelectorAll("item, entry");
  const items = [];

  nodes.forEach((node) => {
    const get = (sel) => node.querySelector(sel)?.textContent?.trim() || "";

    // link: RSS は textContent、Atom は href 属性
    let link = get("link");
    if (!link) link = node.querySelector("link")?.getAttribute("href") || "";

    const rawDesc = get("description") || get("summary") || get("content");
    const dateStr = get("pubDate") || get("published") || get("updated");

    items.push({
      title: stripHtml(get("title")),
      link,
      description: stripHtml(rawDesc).slice(0, 200),
      date: dateStr ? new Date(dateStr) : null,
      source: feed.name,
      category: feed.category,
    });
  });

  return items.slice(0, MAX_ITEMS_PER_FEED);
}

function stripHtml(str) {
  const tmp = document.createElement("div");
  tmp.innerHTML = str;
  return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
}

/* ---------- 描画 ---------- */

function render() {
  const filtered = state.items.filter(
    (it) => state.category === "all" || it.category === state.category
  );

  if (!filtered.length) {
    el.grid.innerHTML = "";
    setStatus(state.loading ? "読み込み中…" : "記事が見つかりませんでした。", state.loading ? "" : "error");
    return;
  }

  setStatus("");
  el.grid.innerHTML = filtered
    .map((it) => {
      const tagLabel = it.category === "politics" ? "政治" : "AI";
      return `
        <a class="card" href="${escapeAttr(it.link)}" target="_blank" rel="noopener noreferrer">
          <span class="card-tag ${it.category}">${tagLabel}</span>
          <h2 class="card-title">${escapeHtml(it.title)}</h2>
          ${it.description ? `<p class="card-desc">${escapeHtml(it.description)}</p>` : ""}
          <div class="card-meta">
            <span class="card-source">${escapeHtml(it.source)}</span>
            <span>${formatDate(it.date)}</span>
          </div>
        </a>`;
    })
    .join("");
}

function setStatus(msg, cls = "") {
  el.status.textContent = msg;
  el.status.className = "status" + (cls ? " " + cls : "");
  el.status.style.display = msg ? "block" : "none";
}

function showSkeletons(n = 6) {
  el.grid.innerHTML = Array.from({ length: n }, () => `<div class="skeleton"></div>`).join("");
}

function formatDate(date) {
  if (!date || isNaN(date)) return "";
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
const escapeAttr = escapeHtml;

/* ---------- ロード処理 ---------- */

async function loadAll() {
  if (state.loading) return;
  state.loading = true;
  el.refresh.disabled = true;
  state.items = [];
  showSkeletons();
  setStatus("最新のニュースを取得しています…");

  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => parseFeed(await fetchWithProxy(feed.url), feed))
  );

  const items = [];
  let failed = 0;
  results.forEach((r) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else failed++;
  });

  // 新しい順に並べ替え（日付不明は末尾）
  items.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  state.items = items;
  state.loading = false;
  el.refresh.disabled = false;

  if (!items.length) {
    setStatus("ニュースを取得できませんでした。時間をおいて再度お試しください。", "error");
  } else {
    el.updated.textContent =
      `最終更新: ${new Date().toLocaleString("ja-JP")}` +
      (failed ? `（${failed}件のフィードは取得失敗）` : "");
    render();
  }
}

/* ---------- イベント ---------- */

el.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    el.tabs.forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    state.category = tab.dataset.category;
    render();
  });
});

el.refresh.addEventListener("click", loadAll);

// 初回ロード
loadAll();
