/**
 * Trusted Research Feed — フロントエンドのみで動くRSSリーダー。
 * RSSフィードをCORSプロキシ経由で取得し、ルールベースの信頼度メタデータを付与して表示。
 * 保存機能・Research Board機能はlocalStorageで実装。
 */

const PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

const MAX_ITEMS_PER_FEED = 12;
const STORAGE_KEY = "trf_saved_articles";
const BOARD_KEY   = "trf_boards";

const state = {
  items: [],
  category: "all",
  loading: false,
  savedFilter: "all",
  activeBoardId: null,
};

const el = {
  grid:          document.getElementById("news-grid"),
  status:        document.getElementById("status"),
  updated:       document.getElementById("updated"),
  refresh:       document.getElementById("refresh"),
  tabs:          document.querySelectorAll(".tab"),
  modal:         document.getElementById("article-modal"),
  modalContent:  document.getElementById("modal-content"),
  modalClose:    document.getElementById("modal-close"),
  savedFilterBar: document.getElementById("saved-filter-bar"),
};

/* ---------- ラベル定数 ---------- */

const TRUST_LABEL       = { high: "高信頼", medium: "中信頼", low: "要確認" };
const TRUST_CLASS       = { high: "trust-high", medium: "trust-medium", low: "trust-low" };
const SOURCE_TYPE_LABEL = { official: "公式", news: "ニュース", research: "研究", blog: "ブログ" };
const FRESHNESS_LABEL   = { fresh: "速報", recent: "最近", old: "古め", stale: "古い(60日+)", unknown: "不明" };
const PURPOSE_OPTIONS   = [
  { value: "later",    label: "あとで読む" },
  { value: "youtube",  label: "YouTube候補" },
  { value: "x",        label: "X投稿候補" },
  { value: "note",     label: "note候補" },
  { value: "research", label: "深掘り候補" },
  { value: "review",   label: "要確認" },
];

/* ---------- localStorage: 保存済み記事 ---------- */

function normalizeSaved(item) {
  return {
    purpose: "later",
    memo: "",
    savedAt: null,
    ...item,
    date: item.date ? new Date(item.date) : null,
  };
}

function getSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]").map(normalizeSaved);
  } catch {
    return [];
  }
}

function isSaved(link) {
  return getSaved().some((s) => s.link === link);
}

function toggleSave(link, item) {
  const saved = getSaved();
  const idx = saved.findIndex((s) => s.link === link);
  if (idx >= 0) {
    saved.splice(idx, 1);
  } else {
    saved.push({ ...item, purpose: "later", memo: "", savedAt: new Date().toISOString() });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

function updateSavedItem(link, updates) {
  const saved = getSaved();
  const idx = saved.findIndex((s) => s.link === link);
  if (idx < 0) return;
  saved[idx] = { ...saved[idx], ...updates };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

/* ---------- localStorage: Research Board ---------- */

function getBoards() {
  try {
    return JSON.parse(localStorage.getItem(BOARD_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveBoards(boards) {
  localStorage.setItem(BOARD_KEY, JSON.stringify(boards));
}

function createBoard(title, description) {
  const boards = getBoards();
  const board = {
    id:           Date.now().toString(),
    title,
    description,
    articleLinks: [],
    notes:        "",
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
  };
  boards.push(board);
  saveBoards(boards);
  return board;
}

function deleteBoard(id) {
  saveBoards(getBoards().filter((b) => b.id !== id));
}

function updateBoard(id, updates) {
  const boards = getBoards();
  const idx = boards.findIndex((b) => b.id === id);
  if (idx < 0) return;
  boards[idx] = { ...boards[idx], ...updates, updatedAt: new Date().toISOString() };
  saveBoards(boards);
}

function addArticleToBoard(boardId, articleLink) {
  const boards = getBoards();
  const board = boards.find((b) => b.id === boardId);
  if (!board || board.articleLinks.includes(articleLink)) return;
  board.articleLinks.push(articleLink);
  board.updatedAt = new Date().toISOString();
  saveBoards(boards);
}

function removeArticleFromBoard(boardId, articleLink) {
  const boards = getBoards();
  const board = boards.find((b) => b.id === boardId);
  if (!board) return;
  board.articleLinks = board.articleLinks.filter((l) => l !== articleLink);
  board.updatedAt = new Date().toISOString();
  saveBoards(boards);
}

/* ---------- 信頼度判定（ルールベース） ---------- */

function enrichItem(item) {
  const url        = (item.link   || "").toLowerCase();
  const sourceName = (item.source || "").toLowerCase();

  let sourceType      = "news";
  let trustScore      = 50;
  let isPrimarySource = false;
  const trustReasons  = [];

  if (url.includes(".go.jp") || url.includes(".gov") || url.includes("government")) {
    sourceType = "official"; trustScore = 85; isPrimarySource = true;
    trustReasons.push({ type: "plus", text: "政府・公式系ソース（ベーススコア 85）" });
  } else if (
    url.includes("arxiv.org") || url.includes(".ac.jp") || url.includes(".edu") ||
    url.includes("/research/") || url.includes("academic")
  ) {
    sourceType = "research"; trustScore = 75; isPrimarySource = true;
    trustReasons.push({ type: "plus", text: "研究機関・論文系ソース（ベーススコア 75）" });
  } else if (
    url.includes("blog") || url.includes("note.com") || url.includes("medium.com") ||
    url.includes("zenn.dev") || url.includes("qiita.com") || sourceName.includes("blog")
  ) {
    sourceType = "blog"; trustScore = 40;
    trustReasons.push({ type: "minus", text: "個人ブログ・投稿プラットフォーム（ベーススコア 40）" });
  } else if (sourceName.includes("nhk") || url.includes("nhk.or.jp")) {
    sourceType = "news"; trustScore = 75;
    trustReasons.push({ type: "plus", text: "NHK（主要公共放送メディア、ベーススコア 75）" });
  } else if (sourceName.includes("itmedia") || url.includes("itmedia.co.jp")) {
    sourceType = "news"; trustScore = 65;
    trustReasons.push({ type: "neutral", text: "ITmedia（IT専門メディア、ベーススコア 65）" });
  } else if (url.includes("news.google.com") || sourceName.includes("google ニュース")) {
    sourceType = "news"; trustScore = 50;
    trustReasons.push({ type: "neutral", text: "Googleニュース経由（アグリゲータ、ベーススコア 50）" });
  } else {
    trustReasons.push({ type: "neutral", text: "ニュースメディア（ベーススコア 50）" });
  }

  if (isPrimarySource) {
    trustReasons.push({ type: "plus", text: "一次情報・公式ソース" });
  } else {
    trustReasons.push({ type: "minus", text: "一次情報ではない（二次報道の可能性）" });
  }

  let freshness = "unknown";
  if (item.date && !isNaN(item.date)) {
    const days = (Date.now() - item.date.getTime()) / 86400000;
    if (days < 1)       { freshness = "fresh";  trustScore += 5;  trustReasons.push({ type: "plus",    text: "24時間以内の速報・公開日確認済み（+5）" }); }
    else if (days < 7)  { freshness = "recent"; trustScore += 2;  trustReasons.push({ type: "plus",    text: "7日以内の新しい記事・公開日確認済み（+2）" }); }
    else if (days < 30) { freshness = "recent";                   trustReasons.push({ type: "neutral", text: "公開から30日以内・公開日確認済み（変動なし）" }); }
    else if (days < 60) { freshness = "old";    trustScore -= 5;  trustReasons.push({ type: "minus",   text: "公開から30〜60日経過（-5）" }); }
    else                { freshness = "stale";  trustScore -= 15; trustReasons.push({ type: "minus",   text: "公開から60日以上経過（-15）" }); }
  } else {
    trustScore -= 5;
    trustReasons.push({ type: "minus", text: "公開日が不明（-5）" });
  }

  trustScore = Math.min(100, Math.max(0, trustScore));
  const trustLevel = trustScore >= 75 ? "high" : trustScore >= 50 ? "medium" : "low";

  // 次に確認すべきこと
  const nextChecks = ["元記事の本文を確認する"];
  if (!isPrimarySource) {
    nextChecks.push("一次情報・公式発表を探して照合する");
  }
  if (url.includes("news.google.com") || sourceName.includes("google ニュース")) {
    nextChecks.push("アグリゲータ経由のため、配信元の記事を直接確認する");
  }
  if (sourceType === "blog") {
    nextChecks.push("著者の専門性・根拠・参照元を確認する");
  }
  if (freshness === "old" || freshness === "stale") {
    nextChecks.push("より新しい情報が出ていないか確認する");
  }
  if (freshness === "unknown") {
    nextChecks.push("記事の公開日・更新日を確認する");
  }
  if (sourceType !== "official") {
    nextChecks.push("他のメディアでも同様に報じられているか確認する");
  }

  const tags = [];
  if (item.category === "politics") tags.push("政治");
  else if (item.category === "ai")  tags.push("AI");
  if (isPrimarySource)              tags.push("一次情報");
  if (sourceType === "official")    tags.push("公式");
  if (sourceType === "research")    tags.push("研究");
  if (freshness === "fresh")        tags.push("速報");

  const cautionNotes = [];
  if (url.includes("news.google.com") || sourceName.includes("google ニュース")) cautionNotes.push("アグリゲータ経由");
  if (sourceType === "blog")          cautionNotes.push("個人ブログ");
  if (freshness === "stale")          cautionNotes.push("古い情報(60日+)");
  if (!item.date || isNaN(item.date)) cautionNotes.push("日付不明");

  return { ...item, sourceType, trustScore, trustLevel, isPrimarySource, freshness, tags, cautionNotes, trustReasons, nextChecks, summary: item.description || "" };
}

/* ---------- 取得 ---------- */

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

function parseFeed(xmlText, feed) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (doc.querySelector("parsererror")) return [];

  const nodes = doc.querySelectorAll("item, entry");
  const items = [];
  nodes.forEach((node) => {
    const get = (sel) => node.querySelector(sel)?.textContent?.trim() || "";
    let link = get("link");
    if (!link) link = node.querySelector("link")?.getAttribute("href") || "";
    const rawDesc = get("description") || get("summary") || get("content");
    const dateStr = get("pubDate") || get("published") || get("updated");
    const base = {
      title:       stripHtml(get("title")),
      link,
      description: stripHtml(rawDesc).slice(0, 200),
      date:        dateStr ? new Date(dateStr) : null,
      source:      feed.name,
      category:    feed.category,
    };
    items.push(enrichItem(base));
  });
  return items.slice(0, MAX_ITEMS_PER_FEED);
}

function stripHtml(str) {
  const tmp = document.createElement("div");
  tmp.innerHTML = str;
  return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
}

/* ---------- ユーティリティ ---------- */

function formatDate(date) {
  if (!date || isNaN(date)) return "";
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 3600)  return `${Math.max(1, Math.floor(diff / 60))}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

function formatSavedAt(isoString) {
  if (!isoString) return "不明";
  const d = new Date(isoString);
  if (isNaN(d)) return "";
  return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
const escapeAttr = escapeHtml;

function sanitizeUrl(url) {
  try {
    const p = new URL(url);
    if (p.protocol === "http:" || p.protocol === "https:") return url;
  } catch {}
  return "#";
}

/* ---------- カードHTML ---------- */

function cardHtml(it) {
  const saved = isSaved(it.link);
  const categoryLabel = it.category === "politics" ? "政治" : "AI";

  const cautionHtml = it.cautionNotes && it.cautionNotes.length
    ? `<div class="card-caution">⚠ ${it.cautionNotes.map(escapeHtml).join(" / ")}</div>`
    : "";

  const tagsHtml = it.tags && it.tags.length
    ? `<div class="card-tags">${it.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";

  let savedMetaHtml = "";
  if (state.category === "saved") {
    const purposeLabel = PURPOSE_OPTIONS.find((p) => p.value === it.purpose)?.label || "あとで読む";
    savedMetaHtml = `
      <div class="card-saved-meta">
        <span class="saved-purpose-badge purpose-${escapeAttr(it.purpose || "later")}">${escapeHtml(purposeLabel)}</span>
        <span class="saved-at">保存: ${formatSavedAt(it.savedAt)}</span>
        ${it.memo ? `<p class="saved-memo">${escapeHtml(it.memo)}</p>` : ""}
      </div>`;
  }

  return `
    <div class="card">
      <div class="card-badges">
        <span class="card-tag ${escapeAttr(it.category)}">${categoryLabel}</span>
        <span class="trust-badge ${TRUST_CLASS[it.trustLevel] || ""}">${TRUST_LABEL[it.trustLevel] || ""}</span>
        <span class="source-type-badge">${escapeHtml(SOURCE_TYPE_LABEL[it.sourceType] || it.sourceType || "")}</span>
      </div>
      <h2 class="card-title">${escapeHtml(it.title)}</h2>
      ${it.summary ? `<p class="card-desc">${escapeHtml(it.summary)}</p>` : ""}
      ${cautionHtml}
      ${tagsHtml}
      ${savedMetaHtml}
      <div class="card-meta">
        <span class="card-source">${escapeHtml(it.source)}</span>
        <span>${formatDate(it.date)}</span>
      </div>
      <div class="card-actions">
        <a class="btn-link" href="${escapeAttr(sanitizeUrl(it.link))}" target="_blank" rel="noopener noreferrer">元記事 ↗</a>
        <button class="btn-detail" data-link="${escapeAttr(it.link)}">詳細</button>
        <button class="btn-save${saved ? " saved" : ""}" data-link="${escapeAttr(it.link)}">
          ${saved ? "保存済み ✓" : "保存"}
        </button>
      </div>
    </div>`;
}

/* ---------- ボード: 一覧HTML ---------- */

function renderBoardList() {
  const boards = getBoards();

  const boardListHtml = boards.length
    ? boards.map((b) => {
        const createdDate = new Date(b.createdAt).toLocaleDateString("ja-JP");
        return `
          <div class="board-card">
            <div class="board-card-header">
              <h3 class="board-card-title">${escapeHtml(b.title)}</h3>
              <div class="board-card-actions">
                <button class="btn-board-detail" data-board-id="${escapeAttr(b.id)}">詳細</button>
                <button class="btn-board-delete" data-board-id="${escapeAttr(b.id)}">削除</button>
              </div>
            </div>
            ${b.description ? `<p class="board-card-desc">${escapeHtml(b.description)}</p>` : ""}
            <div class="board-card-meta">
              <span>記事 ${b.articleLinks.length}件</span>
              <span>作成: ${createdDate}</span>
            </div>
          </div>`;
      }).join("")
    : `<p class="board-empty">ボードがまだありません。上のフォームから作成してください。</p>`;

  el.grid.innerHTML = `
    <div class="board-view">
      <div class="board-create-form">
        <h2 class="board-section-title">新しいボードを作成</h2>
        <div class="board-form-fields">
          <input type="text" id="board-title-input" class="board-input" placeholder="タイトル（必須）" maxlength="100" />
          <input type="text" id="board-desc-input" class="board-input" placeholder="説明（任意）" maxlength="200" />
          <button class="btn-board-create" id="board-create-btn">作成</button>
        </div>
      </div>
      <div class="board-list">
        <h2 class="board-section-title">ボード一覧${boards.length ? ` (${boards.length})` : ""}</h2>
        ${boardListHtml}
      </div>
    </div>`;
}

/* ---------- ボード: 詳細HTML ---------- */

function renderBoardDetail(boardId) {
  const board = getBoards().find((b) => b.id === boardId);
  if (!board) {
    state.activeBoardId = null;
    renderBoardList();
    return;
  }

  const savedArticles = getSaved();
  const boardArticles = board.articleLinks
    .map((link) => savedArticles.find((a) => a.link === link))
    .filter(Boolean);

  const articlesHtml = boardArticles.length
    ? boardArticles.map((a) => {
        const purposeLabel = PURPOSE_OPTIONS.find((p) => p.value === a.purpose)?.label || "あとで読む";
        return `
          <div class="board-article-card">
            <div class="board-article-title">${escapeHtml(a.title)}</div>
            <div class="board-article-meta">
              <span class="card-source">${escapeHtml(a.source)}</span>
              <span class="saved-purpose-badge purpose-${escapeAttr(a.purpose || "later")}">${escapeHtml(purposeLabel)}</span>
            </div>
            ${a.memo ? `<p class="board-article-memo">${escapeHtml(a.memo)}</p>` : ""}
            <div class="board-article-actions">
              <a class="btn-link" href="${escapeAttr(sanitizeUrl(a.link))}" target="_blank" rel="noopener noreferrer">元記事 ↗</a>
              <button class="btn-detail" data-link="${escapeAttr(a.link)}">詳細</button>
              <button class="btn-board-remove-article" data-board-id="${escapeAttr(board.id)}" data-link="${escapeAttr(a.link)}">外す</button>
            </div>
          </div>`;
      }).join("")
    : `<p class="board-empty">登録されている記事がありません。<br>保存済み記事の「詳細」からボードに追加できます。</p>`;

  el.grid.innerHTML = `
    <div class="board-view">
      <div class="board-detail-header">
        <button class="btn-board-back">← 一覧に戻る</button>
        <h2 class="board-detail-title">${escapeHtml(board.title)}</h2>
        ${board.description ? `<p class="board-detail-desc">${escapeHtml(board.description)}</p>` : ""}
      </div>

      <div class="board-notes-section">
        <h3 class="board-section-subtitle">ノート</h3>
        <textarea class="board-notes-textarea" id="board-notes-textarea" rows="4"
          placeholder="このボードのリサーチメモを記入..."
          data-board-id="${escapeAttr(board.id)}">${escapeHtml(board.notes || "")}</textarea>
        <button class="btn-board-save-notes" data-board-id="${escapeAttr(board.id)}">ノートを保存</button>
      </div>

      <div class="board-articles-section">
        <h3 class="board-section-subtitle">登録記事 (${boardArticles.length}件)</h3>
        ${articlesHtml}
      </div>
    </div>`;
}

/* ---------- 記事詳細モーダル ---------- */

let currentModalArticle = null;

function openArticleModal(article) {
  currentModalArticle = article;
  renderModalContent(article);
  el.modal.classList.add("is-open");
  el.modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeArticleModal() {
  el.modal.classList.remove("is-open");
  el.modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  currentModalArticle = null;
}

function renderModalContent(article) {
  const savedItem = getSaved().find((s) => s.link === article.link) || null;
  const saved     = !!savedItem;
  const categoryLabel = article.category === "politics" ? "政治" : "AI";
  const dateStr = article.date && !isNaN(article.date)
    ? article.date.toLocaleString("ja-JP")
    : "不明";

  // trustReasons / nextChecks がない場合（保存済み古データ）は再計算
  let { trustReasons, nextChecks } = article;
  if (!trustReasons || !nextChecks) {
    const re = enrichItem(article);
    trustReasons = re.trustReasons || [];
    nextChecks   = re.nextChecks   || [];
  }

  const tagsHtml = article.tags && article.tags.length
    ? article.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")
    : '<span class="modal-none">なし</span>';

  const cautionHtml = article.cautionNotes && article.cautionNotes.length
    ? article.cautionNotes.map((c) => `<span class="caution-item">⚠ ${escapeHtml(c)}</span>`).join("")
    : '<span class="modal-none">なし</span>';

  // メモ・用途編集セクション（保存済み記事のみ）
  const editSectionHtml = savedItem ? `
    <div class="modal-section modal-edit-section">
      <h3 class="modal-section-title">メモ・用途</h3>
      <div class="modal-edit-form">
        <label class="modal-edit-label" for="modal-purpose">用途</label>
        <select id="modal-purpose" class="modal-purpose-select" data-link="${escapeAttr(article.link)}">
          ${PURPOSE_OPTIONS.map((p) => `<option value="${p.value}"${savedItem.purpose === p.value ? " selected" : ""}>${escapeHtml(p.label)}</option>`).join("")}
        </select>
        <label class="modal-edit-label" for="modal-memo">メモ</label>
        <textarea id="modal-memo" class="modal-memo-textarea" data-link="${escapeAttr(article.link)}" placeholder="メモを入力..." rows="3">${escapeHtml(savedItem.memo || "")}</textarea>
        <button class="btn-update-saved" data-link="${escapeAttr(article.link)}">保存内容を更新</button>
      </div>
    </div>` : "";

  // ボードに追加セクション（保存済み記事のみ）
  let boardSectionHtml = "";
  if (savedItem) {
    const boards = getBoards();
    if (boards.length) {
      const optionsHtml = boards.map((b) => {
        const alreadyIn = b.articleLinks.includes(article.link);
        return `<option value="${escapeAttr(b.id)}"${alreadyIn ? " disabled" : ""}>${escapeHtml(b.title)}${alreadyIn ? " (追加済み)" : ""}</option>`;
      }).join("");
      boardSectionHtml = `
        <div class="modal-section modal-board-section">
          <h3 class="modal-section-title">ボードに追加</h3>
          <div class="modal-board-form">
            <select class="modal-board-select" data-link="${escapeAttr(article.link)}">
              <option value="">ボードを選択...</option>
              ${optionsHtml}
            </select>
            <button class="btn-add-to-board" data-link="${escapeAttr(article.link)}">追加</button>
          </div>
        </div>`;
    } else {
      boardSectionHtml = `
        <div class="modal-section modal-board-section">
          <h3 class="modal-section-title">ボードに追加</h3>
          <p class="modal-none">ボードがありません。「ボード」タブから作成してください。</p>
        </div>`;
    }
  }

  el.modalContent.innerHTML = `
    <div class="modal-header">
      <div class="card-badges">
        <span class="card-tag ${escapeAttr(article.category)}">${categoryLabel}</span>
        <span class="trust-badge ${TRUST_CLASS[article.trustLevel] || ""}">${escapeHtml(TRUST_LABEL[article.trustLevel] || "")}</span>
        <span class="source-type-badge">${escapeHtml(SOURCE_TYPE_LABEL[article.sourceType] || article.sourceType || "")}</span>
      </div>
      <h2 class="modal-title" id="modal-title">${escapeHtml(article.title)}</h2>
    </div>

    ${article.summary ? `<p class="modal-summary">${escapeHtml(article.summary)}</p>` : ""}

    <div class="modal-meta-grid">
      <div class="modal-meta-item">
        <span class="modal-meta-label">情報源</span>
        <span>${escapeHtml(article.source)}</span>
      </div>
      <div class="modal-meta-item">
        <span class="modal-meta-label">公開日</span>
        <span>${dateStr}</span>
      </div>
      <div class="modal-meta-item">
        <span class="modal-meta-label">ソース種別</span>
        <span>${escapeHtml(SOURCE_TYPE_LABEL[article.sourceType] || article.sourceType || "不明")}</span>
      </div>
      <div class="modal-meta-item">
        <span class="modal-meta-label">一次情報性</span>
        <span>${article.isPrimarySource ? "一次情報に近い" : "二次情報・ニュース経由"}</span>
      </div>
      <div class="modal-meta-item">
        <span class="modal-meta-label">鮮度</span>
        <span>${escapeHtml(FRESHNESS_LABEL[article.freshness] || "不明")}</span>
      </div>
      <div class="modal-meta-item">
        <span class="modal-meta-label">信頼スコア</span>
        <span>${article.trustScore !== undefined ? article.trustScore + " / 100" : "不明"}</span>
      </div>
    </div>

    <div class="modal-section">
      <h3 class="modal-section-title">タグ</h3>
      <div class="card-tags">${tagsHtml}</div>
    </div>

    <div class="modal-section modal-section-card">
      <h3 class="modal-section-title">注意事項</h3>
      <div class="modal-caution-list">${cautionHtml}</div>
    </div>

    <div class="modal-section modal-section-card">
      <h3 class="modal-section-title">信頼スコアの根拠</h3>
      <ul class="trust-reasons-list">
        ${trustReasons.map((r) => `
          <li class="trust-reason trust-reason-${escapeAttr(r.type)}">
            <span class="trust-reason-icon">${r.type === "plus" ? "+" : r.type === "minus" ? "−" : "·"}</span>
            <span class="trust-reason-text">${escapeHtml(r.text)}</span>
          </li>`).join("")}
      </ul>
    </div>

    ${nextChecks.length ? `
    <div class="modal-section modal-section-card">
      <h3 class="modal-section-title">次に確認すべきこと</h3>
      <ul class="next-checks-list">
        ${nextChecks.map((c) => `<li class="next-check-item">${escapeHtml(c)}</li>`).join("")}
      </ul>
    </div>` : ""}

    ${editSectionHtml}
    ${boardSectionHtml}

    <div class="modal-actions">
      <a class="btn-link" href="${escapeAttr(sanitizeUrl(article.link))}" target="_blank" rel="noopener noreferrer">元記事 ↗</a>
      <button class="btn-save modal-save-btn${saved ? " saved" : ""}" data-link="${escapeAttr(article.link)}">
        ${saved ? "保存済み ✓" : "保存"}
      </button>
    </div>
  `;
}

/* ---------- 描画 ---------- */

function render() {
  // ボードタブ
  if (state.category === "board") {
    el.savedFilterBar.style.display = "none";
    setStatus("");
    if (state.activeBoardId) {
      renderBoardDetail(state.activeBoardId);
    } else {
      renderBoardList();
    }
    return;
  }

  // 保存済みフィルターバー
  if (state.category === "saved") {
    el.savedFilterBar.style.display = "";
    el.savedFilterBar.innerHTML = [{ value: "all", label: "すべて" }, ...PURPOSE_OPTIONS]
      .map((p) => `<button class="purpose-filter-btn${state.savedFilter === p.value ? " is-active" : ""}" data-purpose="${escapeAttr(p.value)}">${escapeHtml(p.label)}</button>`)
      .join("");
  } else {
    el.savedFilterBar.style.display = "none";
    state.savedFilter = "all";
  }

  const filtered =
    state.category === "saved"
      ? getSaved().filter((it) => state.savedFilter === "all" || it.purpose === state.savedFilter)
      : state.items.filter((it) => state.category === "all" || it.category === state.category);

  if (!filtered.length) {
    if (state.loading) { setStatus("読み込み中…"); return; }
    setStatus("");
    let msg = "", hint = "";
    if (state.category === "saved" && state.savedFilter !== "all") {
      msg  = "この用途の保存済み記事はありません。";
      hint = "フィルターを「すべて」に戻すか、記事を保存してから用途を設定してください。";
    } else if (state.category === "saved") {
      msg  = "保存済みの記事はまだありません。";
      hint = "記事カードの「保存」ボタン、または詳細モーダルから保存できます。";
    } else {
      msg  = "記事が見つかりませんでした。";
      hint = "「更新」ボタンで再読み込みしてください。";
    }
    el.grid.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-message">${escapeHtml(msg)}</p>
        ${hint ? `<p class="empty-state-hint">${escapeHtml(hint)}</p>` : ""}
      </div>`;
    return;
  }

  setStatus("");
  el.grid.innerHTML = filtered.map(cardHtml).join("");
}

function setStatus(msg, cls = "") {
  el.status.textContent = msg;
  el.status.className   = "status" + (cls ? " " + cls : "");
  el.status.style.display = msg ? "block" : "none";
}

function showSkeletons(n = 6) {
  el.grid.innerHTML = Array.from({ length: n }, () => `<div class="skeleton"></div>`).join("");
}

/* ---------- ロード ---------- */

async function loadAll() {
  if (state.loading) return;
  state.loading = true;
  el.refresh.disabled = true;
  state.items = [];
  showSkeletons();
  setStatus("最新のニュースを取得しています…");

  try {
    if (typeof FEEDS === "undefined" || !FEEDS.length) {
      throw new Error("フィードが定義されていません");
    }

    const results = await Promise.allSettled(
      FEEDS.map(async (feed) => parseFeed(await fetchWithProxy(feed.url), feed))
    );

    const items = [];
    let failed = 0;
    results.forEach((r) => {
      if (r.status === "fulfilled") items.push(...r.value);
      else failed++;
    });

    items.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
    state.items = items;

    if (!items.length) {
      setStatus("記事の取得に失敗しました。", "error");
      el.grid.innerHTML = `
        <div class="empty-state">
          <p class="empty-state-message">記事の取得に失敗しました。</p>
          <p class="empty-state-hint">時間をおいて更新するか、RSS配信元・CORSプロキシの状態を確認してください。</p>
        </div>`;
    } else {
      el.updated.textContent =
        `最終更新: ${new Date().toLocaleString("ja-JP")}` +
        (failed ? `（${failed}件のフィードは取得失敗）` : "");
      render();
    }
  } catch (err) {
    setStatus("読み込みに失敗しました: " + err.message, "error");
  } finally {
    state.loading = false;
    el.refresh.disabled = false;
  }
}

/* ---------- イベント ---------- */

// タブ
el.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    el.tabs.forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    state.category = tab.dataset.category;
    if (state.category !== "board") state.activeBoardId = null;
    render();
  });
});

// 更新ボタン
el.refresh.addEventListener("click", () => {
  if (state.category === "saved" || state.category === "board") {
    el.tabs.forEach((t) => t.classList.remove("is-active"));
    const allTab = document.querySelector('.tab[data-category="all"]');
    if (allTab) allTab.classList.add("is-active");
    state.category = "all";
    state.activeBoardId = null;
  }
  loadAll();
});

// 保存済みフィルターバー
el.savedFilterBar.addEventListener("click", (e) => {
  const btn = e.target.closest(".purpose-filter-btn");
  if (!btn) return;
  state.savedFilter = btn.dataset.purpose;
  render();
});

// グリッド（イベント委譲 — カード・ボードUI共通）
el.grid.addEventListener("click", (e) => {
  // 詳細ボタン（カード & ボード記事共通）
  const detailBtn = e.target.closest(".btn-detail");
  if (detailBtn) {
    const link = detailBtn.dataset.link;
    const item = state.items.find((it) => it.link === link) || getSaved().find((it) => it.link === link);
    if (item) openArticleModal(item);
    return;
  }

  // 保存ボタン（カードのみ）
  const saveBtn = e.target.closest(".btn-save");
  if (saveBtn && !saveBtn.classList.contains("modal-save-btn")) {
    const link = saveBtn.dataset.link;
    const item = state.items.find((it) => it.link === link) || getSaved().find((it) => it.link === link);
    if (!item) return;
    toggleSave(link, item);
    if (state.category === "saved") {
      render();
    } else {
      const nowSaved = isSaved(link);
      saveBtn.textContent = nowSaved ? "保存済み ✓" : "保存";
      saveBtn.classList.toggle("saved", nowSaved);
    }
    return;
  }

  // ボード: 作成ボタン
  if (e.target.closest("#board-create-btn")) {
    const titleInput = document.getElementById("board-title-input");
    const descInput  = document.getElementById("board-desc-input");
    const title = titleInput?.value.trim();
    if (!title) {
      titleInput?.focus();
      return;
    }
    createBoard(title, descInput?.value.trim() || "");
    render();
    return;
  }

  // ボード: 詳細ボタン（一覧 → 詳細）
  const boardDetailBtn = e.target.closest(".btn-board-detail");
  if (boardDetailBtn) {
    state.activeBoardId = boardDetailBtn.dataset.boardId;
    render();
    return;
  }

  // ボード: 削除ボタン
  const boardDeleteBtn = e.target.closest(".btn-board-delete");
  if (boardDeleteBtn) {
    const boards = getBoards();
    const board  = boards.find((b) => b.id === boardDeleteBtn.dataset.boardId);
    if (!board) return;
    if (!confirm(`「${board.title}」を削除しますか？`)) return;
    deleteBoard(boardDeleteBtn.dataset.boardId);
    render();
    return;
  }

  // ボード: 一覧に戻るボタン
  if (e.target.closest(".btn-board-back")) {
    state.activeBoardId = null;
    render();
    return;
  }

  // ボード: ノート保存ボタン
  const saveNotesBtn = e.target.closest(".btn-board-save-notes");
  if (saveNotesBtn) {
    const boardId  = saveNotesBtn.dataset.boardId;
    const textarea = document.getElementById("board-notes-textarea");
    if (!textarea) return;
    updateBoard(boardId, { notes: textarea.value });
    saveNotesBtn.textContent = "保存しました ✓";
    saveNotesBtn.disabled = true;
    setTimeout(() => {
      saveNotesBtn.textContent = "ノートを保存";
      saveNotesBtn.disabled = false;
    }, 1500);
    return;
  }

  // ボード: 記事を外すボタン
  const removeArticleBtn = e.target.closest(".btn-board-remove-article");
  if (removeArticleBtn) {
    const { boardId, link } = removeArticleBtn.dataset;
    removeArticleFromBoard(boardId, link);
    render();
    return;
  }
});

// モーダル: 閉じるボタン
el.modalClose.addEventListener("click", closeArticleModal);

// モーダル: 背景クリックで閉じる
el.modal.addEventListener("click", (e) => {
  if (e.target === el.modal) closeArticleModal();
});

// モーダル内クリック
el.modalContent.addEventListener("click", (e) => {
  // 保存 / 保存解除
  const saveBtn = e.target.closest(".modal-save-btn");
  if (saveBtn) {
    const link = saveBtn.dataset.link;
    const item = state.items.find((it) => it.link === link) || getSaved().find((it) => it.link === link);
    if (!item) return;

    toggleSave(link, item);
    const nowSaved = isSaved(link);

    if (currentModalArticle && currentModalArticle.link === link) {
      renderModalContent(currentModalArticle);
    }

    el.grid.querySelectorAll(".btn-save").forEach((b) => {
      if (b.dataset.link === link) {
        b.textContent = nowSaved ? "保存済み ✓" : "保存";
        b.classList.toggle("saved", nowSaved);
      }
    });

    if (state.category === "saved" || state.category === "board") render();
    return;
  }

  // 保存内容を更新
  const updateBtn = e.target.closest(".btn-update-saved");
  if (updateBtn) {
    const link     = updateBtn.dataset.link;
    const select   = el.modalContent.querySelector(".modal-purpose-select");
    const textarea = el.modalContent.querySelector(".modal-memo-textarea");
    if (!select || !textarea) return;

    updateSavedItem(link, { purpose: select.value, memo: textarea.value });

    updateBtn.textContent = "更新しました ✓";
    updateBtn.disabled = true;
    setTimeout(() => {
      updateBtn.textContent = "保存内容を更新";
      updateBtn.disabled = false;
    }, 1500);

    if (state.category === "saved") render();
    return;
  }

  // ボードに追加
  const addBoardBtn = e.target.closest(".btn-add-to-board");
  if (addBoardBtn) {
    const link   = addBoardBtn.dataset.link;
    const select = el.modalContent.querySelector(".modal-board-select");
    if (!select || !select.value) return;

    addArticleToBoard(select.value, link);

    // 追加したオプションを "(追加済み)" に更新し、フィードバック表示
    const selected = select.options[select.selectedIndex];
    if (selected) {
      selected.text    += " (追加済み)";
      selected.disabled = true;
    }
    select.value = "";

    addBoardBtn.textContent = "追加しました ✓";
    addBoardBtn.disabled = true;
    setTimeout(() => {
      addBoardBtn.textContent = "追加";
      addBoardBtn.disabled = false;
    }, 1500);
    return;
  }
});

// Escape キーでモーダルを閉じる
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && el.modal.classList.contains("is-open")) {
    closeArticleModal();
  }
});

// タイトル入力でEnterキー押下時に作成
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "board-title-input") {
    document.getElementById("board-create-btn")?.click();
  }
});

// 保存データリセット
document.getElementById("reset-data-btn").addEventListener("click", () => {
  if (!confirm("保存済み記事とボードをすべて削除しますか？\n（RSS取得データには影響しません）")) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(BOARD_KEY);
  if (state.category === "saved" || state.category === "board") {
    state.category = "all";
    state.activeBoardId = null;
    el.tabs.forEach((t) => t.classList.remove("is-active"));
    document.querySelector('.tab[data-category="all"]').classList.add("is-active");
  }
  render();
});

// 初回ロード
loadAll();
