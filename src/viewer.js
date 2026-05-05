const stateEl = document.getElementById("state");
const jsonEl = document.getElementById("json");

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.latestCapture?.newValue) {
    return;
  }

  renderCapture(changes.latestCapture.newValue);
  void chrome.storage.local.remove("latestCapture");
});

init();

async function init() {
  const stored = await chrome.storage.local.get("latestCapture");
  if (stored.latestCapture) {
    renderCapture(stored.latestCapture);
    await chrome.storage.local.remove("latestCapture");
  }
}

function renderCapture(capture) {
  stateEl.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "grid";

  wrapper.appendChild(renderMeta(capture));
  wrapper.appendChild(renderDom(capture.dom));
  wrapper.appendChild(renderRequests(capture.network || []));

  stateEl.appendChild(wrapper);
  jsonEl.textContent = JSON.stringify(capture, null, 2);
}

function renderMeta(capture) {
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <div class="pill">Получено ${escapeHtml(capture.createdAt || "")}</div>
    <div class="meta-grid">
      <article class="metric">
        <span class="metric__label">Страница</span>
        <div class="metric__value">${escapeHtml(capture.page?.title || "Без заголовка")}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Адрес</span>
        <div class="metric__value">${escapeHtml(capture.page?.url || "—")}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Событие</span>
        <div class="metric__value">${escapeHtml(capture.interaction?.type || "—")} · ${escapeHtml(formatTimestamp(capture.interaction?.timestamp))}</div>
      </article>
    </div>
  `;
  return section;
}

function renderDom(dom) {
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <h2 class="section-title">DOM-снимок</h2>
    <p class="section-copy">Минимальный контекст выбранного элемента: кто он, где расположен и какой текст пользователь видел в момент захвата.</p>
    <div class="meta-grid">
      <article class="metric">
        <span class="metric__label">Элемент</span>
        <div class="metric__value">${escapeHtml(dom?.tagName || "—")}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Позиция</span>
        <div class="metric__value">${escapeHtml(JSON.stringify(dom?.rect || {}))}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Стили</span>
        <div class="metric__value">${escapeHtml(JSON.stringify(dom?.computedStyle || {}))}</div>
      </article>
    </div>
    <div class="surface">
      <strong>Текст элемента</strong>
      <pre>${escapeHtml(dom?.innerText || "")}</pre>
    </div>
    <div class="surface">
      <strong>HTML-фрагмент</strong>
      <pre>${escapeHtml(dom?.outerHTML || "")}</pre>
    </div>
  `;
  return section;
}

function renderRequests(requests) {
  const section = document.createElement("section");
  section.className = "grid";

  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = `Выбранные запросы (${requests.length})`;
  section.appendChild(heading);

  const copy = document.createElement("p");
  copy.className = "section-copy";
  copy.textContent = "Это те ответы, которые пользователь подтвердил для передачи в LLM-контекст.";
  section.appendChild(copy);

  if (requests.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Нет выбранных запросов.";
    section.appendChild(empty);
    return section;
  }

  requests.forEach((request) => {
    const card = document.createElement("article");
    card.className = "request";
    card.innerHTML = `
      <div class="request__header">
        <div class="request__title">${escapeHtml(request.method || "")} ${escapeHtml(request.url || "")}</div>
        <div class="request__meta">Status ${escapeHtml(String(request.status || ""))}</div>
      </div>
      <div class="request__meta">${escapeHtml(request.contentType || "unknown content type")}</div>
      <pre>${escapeHtml(request.responseBody || "")}</pre>
    `;
    section.appendChild(card);
  });

  return section;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("ru-RU");
}
