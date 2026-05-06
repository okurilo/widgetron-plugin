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
  wrapper.appendChild(renderRecipe(getElementRecipe(capture)));
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

function renderRecipe(recipe) {
  const section = document.createElement("section");
  section.className = "grid";

  const bindings = recipe.bindings || recipe.dataRequirements || [];
  const matchesCount = bindings.length;
  const steps = recipe.apiSequence || [];
  const apiDependencies = getApiDependencies(recipe);

  section.innerHTML = `
    <h2 class="section-title">API-рецепт элемента</h2>
    <div class="meta-grid">
      <article class="metric">
        <span class="metric__label">Селектор</span>
        <div class="metric__value">${escapeHtml(recipe.element?.selector || "—")}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Уверенность</span>
        <div class="metric__value">${escapeHtml(formatConfidence(recipe.confidence))}</div>
      </article>
      <article class="metric">
        <span class="metric__label">API-вызовы</span>
        <div class="metric__value">${steps.length}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Поля данных</span>
        <div class="metric__value">${matchesCount}</div>
      </article>
    </div>
  `;

  if (bindings.length > 0) {
    section.appendChild(renderBindingExplorer(recipe));
  }

  if (steps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Для элемента сохранён только DOM-контекст.";
    section.appendChild(empty);
    return section;
  }

  const sequence = document.createElement("div");
  sequence.className = "timeline";
  if (apiDependencies.length > 0) {
    section.appendChild(renderSequenceDiagram(apiDependencies));
  }
  steps.forEach((step) => {
    sequence.appendChild(renderApiStep(step));
  });
  section.appendChild(sequence);

  return section;
}

function renderBindingExplorer(recipe) {
  const surface = document.createElement("div");
  surface.className = "surface binding-explorer";

  const title = document.createElement("strong");
  title.textContent = "Карта значений";

  const layout = document.createElement("div");
  layout.className = "binding-layout";

  const list = document.createElement("div");
  list.className = "binding-list";

  const panel = document.createElement("div");
  panel.className = "binding-detail";

  const bindings = (recipe.bindings || recipe.dataRequirements || []).slice(0, 40);
  bindings.forEach((binding, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `binding-chip${index === 0 ? " binding-chip--active" : ""}`;
    button.innerHTML = `
      <span>${escapeHtml(binding.domValue || binding.value || "")}</span>
      <small>${escapeHtml(formatConfidenceScore(binding.confidence))} · ${escapeHtml(binding.responsePath || binding.path || "")}</small>
      <small>${escapeHtml(shortEndpoint(binding))}</small>
    `;
    button.addEventListener("click", () => {
      list.querySelectorAll(".binding-chip--active").forEach((active) => {
        active.classList.remove("binding-chip--active");
      });
      button.classList.add("binding-chip--active");
      renderBindingDetail(panel, binding, recipe);
    });
    list.appendChild(button);
  });

  layout.append(list, panel);
  surface.append(title, layout);

  if (bindings[0]) {
    renderBindingDetail(panel, bindings[0], recipe);
  }

  return surface;
}

function renderBindingDetail(panel, binding, recipe) {
  const domFact = findById(recipe.domFacts, binding.domFactId);
  const responseFact = findById(recipe.responseFacts, binding.responseFactId);
  const evidence = binding.evidence || [];
  const reasons = binding.reasons || [];
  const endpoint = `${binding.method || ""} ${binding.url || ""}`.trim();
  const alternatives = getBindingAlternatives(recipe, binding);

  panel.innerHTML = `
    <div class="binding-detail__headline">
      <span>${escapeHtml(binding.domValue || binding.value || "")}</span>
      <strong>${escapeHtml(formatConfidenceScore(binding.confidence))}</strong>
    </div>
    <div class="detail-grid">
      <div>
        <span class="metric__label">Backend</span>
        <div class="metric__value">${escapeHtml(endpoint || "—")}</div>
      </div>
      <div>
        <span class="metric__label">JSON path</span>
        <div class="metric__value">${escapeHtml(binding.responsePath || binding.path || "—")}</div>
      </div>
      <div>
        <span class="metric__label">DOM selector</span>
        <div class="metric__value">${escapeHtml(binding.dom?.selector || domFact?.selector || "—")}</div>
      </div>
      <div>
        <span class="metric__label">Response key</span>
        <div class="metric__value">${escapeHtml(binding.responseKey || responseFact?.key || "—")}</div>
      </div>
    </div>
    <div class="reason-list">
      ${reasons.map((reason) => `<span>${escapeHtml(formatReason(reason))}</span>`).join("")}
    </div>
    <div class="surface surface--code">
      <strong>DOM context</strong>
      <pre>${escapeHtml(JSON.stringify(binding.dom?.context || domFact?.context || {}, null, 2))}</pre>
    </div>
    <div class="surface surface--code">
      <strong>Sibling fields</strong>
      <pre>${escapeHtml(JSON.stringify(binding.response?.siblingFields || responseFact?.siblingFields || {}, null, 2))}</pre>
    </div>
  `;

  if (evidence.length > 0) {
    panel.appendChild(renderCodeBlock("Render evidence", JSON.stringify(evidence, null, 2)));
  }

  if (alternatives.length > 0) {
    panel.appendChild(renderAlternatives(alternatives));
  }
}

function renderAlternatives(alternatives) {
  const surface = document.createElement("div");
  surface.className = "surface alternative-list";
  surface.innerHTML = "<strong>Альтернативные API для этого значения</strong>";

  alternatives.slice(0, 6).forEach((binding) => {
    const item = document.createElement("div");
    item.className = "alternative-row";
    item.innerHTML = `
      <span>${escapeHtml(formatConfidenceScore(binding.confidence))}</span>
      <strong>${escapeHtml(shortEndpoint(binding))}</strong>
      <small>${escapeHtml(binding.responsePath || binding.path || "")}</small>
      <small>${escapeHtml((binding.reasons || []).map(formatReason).join(", "))}</small>
    `;
    surface.appendChild(item);
  });

  return surface;
}

function getBindingAlternatives(recipe, binding) {
  return (recipe.bindings || recipe.dataRequirements || [])
    .filter((item) => (
      item !== binding &&
      item.domFactId === binding.domFactId &&
      (item.requestId !== binding.requestId || item.responsePath !== binding.responsePath)
    ))
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
}

function renderSequenceDiagram(sequence) {
  const surface = document.createElement("div");
  surface.className = "surface sequence-diagram";

  const title = document.createElement("strong");
  title.textContent = "Sequence зависимостей API";
  surface.appendChild(title);

  const rows = document.createElement("div");
  rows.className = "sequence-rows";
  (sequence || []).forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "sequence-row";
    row.innerHTML = `
      <span class="sequence-row__index">${escapeHtml(String(index + 1))}</span>
      <span class="sequence-node">
        <small>Ответ #${escapeHtml(String(item.fromStep || ""))}</small>
        <strong>${escapeHtml(item.fromLabel || item.fromRequestId || "API")}</strong>
      </span>
      <span class="sequence-row__arrow">→</span>
      <span class="sequence-node">
        <small>Запрос #${escapeHtml(String(item.toStep || ""))}</small>
        <strong>${escapeHtml(item.toLabel || item.toRequestId || "API")}</strong>
      </span>
      <span class="sequence-row__label">
        <strong>${escapeHtml(formatDependencySource(item))} → ${escapeHtml(formatDependencyTarget(item.target))}</strong>
        <small>${escapeHtml(formatDependencyMeta(item))}</small>
      </span>
      <strong class="sequence-row__confidence">${escapeHtml(formatConfidenceScore(item.confidence))}</strong>
    `;
    rows.appendChild(row);
  });

  surface.appendChild(rows);
  return surface;
}

function getApiDependencies(recipe) {
  const direct = (recipe.apiDependencies || []).filter(isApiDependency);
  if (direct.length > 0) {
    return direct;
  }

  return (recipe.sequence || []).filter(isApiDependency);
}

function isApiDependency(item) {
  return Boolean(item?.fromRequestId && item?.toRequestId && item?.source && item?.target);
}

function formatDependencySource(item) {
  return item.source?.path || item.sourcePath || "response";
}

function formatDependencyTarget(target = {}) {
  const labels = {
    url: "URL",
    body: "Request body",
    headers: "Header"
  };
  const location = labels[target.location] || target.location || "request";
  const path = target.path || target.key || "";
  return path ? `${location}: ${path}` : location;
}

function formatDependencyMeta(item) {
  const parts = [];
  if (item.value) {
    parts.push(`значение: ${item.value}`);
  }
  if (item.reasons?.length) {
    parts.push(item.reasons.map(formatReason).join(", "));
  }
  return parts.join(" · ");
}

function renderDataRequirements(requirements = []) {
  const surface = document.createElement("div");
  surface.className = "surface";

  const title = document.createElement("strong");
  title.textContent = "Данные, найденные в выбранном элементе";
  surface.appendChild(title);

  const list = document.createElement("div");
  list.className = "match-list";
  requirements.slice(0, 16).forEach((item) => {
    const row = document.createElement("div");
    row.className = "match-row";
    row.innerHTML = `
      <span class="match-row__path">#${escapeHtml(String(item.step || ""))} ${escapeHtml(item.path || "")}</span>
      <span class="match-row__value">${escapeHtml(item.value || "")}</span>
    `;
    list.appendChild(row);
  });

  surface.appendChild(list);
  return surface;
}

function renderApiStep(step) {
  const card = document.createElement("article");
  card.className = "request request--step";

  const matchedFields = step.response?.matchedFields || [];
  const requestBody = step.request?.body || "";
  const initiatorStack = step.request?.initiatorStack || "";

  card.innerHTML = `
    <div class="request__header">
      <div>
        <div class="request__title">${escapeHtml(step.step || "")}. ${escapeHtml(step.method || "GET")} ${escapeHtml(step.url || "")}</div>
        <div class="request__meta">${escapeHtml(formatStepTiming(step))}</div>
      </div>
      <div class="request__meta">Status ${escapeHtml(String(step.status || ""))}</div>
    </div>
    <div class="request__meta">${escapeHtml(step.contentType || "unknown content type")}</div>
  `;

  if (requestBody) {
    card.appendChild(renderCodeBlock("Request body", requestBody));
  }

  if (initiatorStack) {
    card.appendChild(renderCodeBlock("Frontend call stack", initiatorStack));
  }

  if (matchedFields.length > 0) {
    const matches = document.createElement("div");
    matches.className = "match-list match-list--compact";
    matchedFields.forEach((field) => {
      const item = document.createElement("div");
      item.className = "match-row";
      item.innerHTML = `
        <span class="match-row__path">${escapeHtml(field.path || "")}</span>
        <span class="match-row__value">${escapeHtml(field.value || "")}</span>
      `;
      matches.appendChild(item);
    });
    card.appendChild(matches);
  }

  card.appendChild(renderCodeBlock("Response shape", JSON.stringify(step.response?.shape || {}, null, 2)));
  card.appendChild(renderCodeBlock("Response preview", step.response?.bodyPreview || ""));

  return card;
}

function renderCodeBlock(title, value) {
  const surface = document.createElement("div");
  surface.className = "surface surface--code";
  surface.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <pre>${escapeHtml(value || "")}</pre>
  `;
  return surface;
}

function renderDom(dom) {
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <h2 class="section-title">DOM-снимок</h2>
    <div class="meta-grid">
      <article class="metric">
        <span class="metric__label">Элемент</span>
        <div class="metric__value">${escapeHtml(dom?.tagName || "—")}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Селектор</span>
        <div class="metric__value">${escapeHtml(dom?.selector || "—")}</div>
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
  `;

  if (dom?.previewHTML) {
    section.appendChild(renderElementPreview(dom.previewHTML));
  }

  section.appendChild(renderCodeBlock("Текст элемента", dom?.innerText || ""));
  section.appendChild(renderCodeBlock("HTML-фрагмент", dom?.outerHTML || ""));
  return section;
}

function renderElementPreview(previewHTML) {
  const surface = document.createElement("div");
  surface.className = "surface";

  const title = document.createElement("strong");
  title.textContent = "Превью элемента";

  const frame = document.createElement("iframe");
  frame.className = "element-preview";
  frame.setAttribute("sandbox", "");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.srcdoc = buildPreviewDocument(previewHTML);

  surface.append(title, frame);
  return surface;
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
  copy.textContent = "Подтверждённые ответы из локального захвата.";
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

function getElementRecipe(capture) {
  if (capture.cloneSpec) {
    return capture.cloneSpec;
  }

  if (capture.elementRecipe) {
    return capture.elementRecipe;
  }

  const network = capture.network || [];
  return {
    version: 0,
    confidence: network.length > 0 ? "low" : "dom-only",
    element: {
      selector: capture.dom?.selector || "",
      tagName: capture.dom?.tagName || "",
      textPreview: capture.dom?.innerText || ""
    },
    domFacts: capture.dom?.facts || [],
    responseFacts: [],
    bindings: [],
    renderEvidence: [],
    apiSequence: network.map((request, index) => ({
      requestId: request.id || `request-${index + 1}`,
      step: index + 1,
      method: request.method || "GET",
      url: request.url || "",
      status: request.status || 0,
      contentType: request.contentType || "",
      calledAt: request.timestamp ? new Date(Number(request.timestamp)).toISOString() : "",
      relativeToInteractionMs: null,
      request: {
        headers: request.requestHeaders || {},
        body: request.requestBody || "",
        initiatorStack: request.initiatorStack || ""
      },
      response: {
        headers: request.responseHeaders || {},
        bodyPreview: request.responseBody || "",
        shape: {},
        matchedFields: []
      }
    })),
    apiDependencies: [],
    dataRequirements: [],
    sequence: []
  };
}

function findById(items = [], id) {
  return (items || []).find((item) => item.id === id) || null;
}

function formatConfidence(value) {
  const labels = {
    high: "Высокая",
    medium: "Средняя",
    low: "Низкая",
    "dom-only": "Только DOM"
  };

  return labels[value] || value || "—";
}

function formatConfidenceScore(value) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    return `${Math.round(number * 100)}%`;
  }

  return formatConfidence(value);
}

function shortEndpoint(binding) {
  const endpoint = `${binding.method || ""} ${binding.url || ""}`.trim();
  if (!endpoint) {
    return "—";
  }

  return endpoint.length <= 96 ? endpoint : `${endpoint.slice(0, 93)}...`;
}

function formatReason(reason) {
  const labels = {
    "exact-text-match": "точный текст",
    "normalized-value-match": "нормализованное значение",
    "duration-number-match": "длительность к числу",
    "text-fragment-match": "фрагмент текста",
    "same-object-context": "контекст объекта",
    "response-key-context": "ключ ответа",
    "semantic-context-match": "семантический контекст",
    "post-response-mutation": "DOM обновился после ответа",
    "weak-numeric-match": "слабое числовое совпадение",
    "response-value-reused-in-request": "значение из ответа использовано в следующем запросе",
    "request-url-query": "совпало с query-параметром",
    "request-url-path": "совпало с path-сегментом",
    "request-body-json": "совпало с JSON body",
    "request-body-form": "совпало с form body",
    "request-body-text": "совпало с текстом body",
    "request-header": "совпало с request header",
    "request-key-context": "совпал контекст ключа запроса",
    "semantic-request-context": "семантика запроса совпала"
  };

  return labels[reason] || reason;
}

function formatStepTiming(step) {
  const parts = [];
  if (step.calledAt) {
    parts.push(new Date(step.calledAt).toLocaleString("ru-RU"));
  }
  if (Number.isFinite(step.relativeToInteractionMs)) {
    const sign = step.relativeToInteractionMs >= 0 ? "+" : "";
    parts.push(`${sign}${step.relativeToInteractionMs} мс от клика`);
  }

  return parts.join(" · ") || "Время неизвестно";
}

function buildPreviewDocument(previewHTML) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        padding: 16px;
        display: grid;
        place-items: center;
        background: #f8fafc;
        color: #111827;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .preview-root {
        max-width: 100%;
        overflow: auto;
      }
    </style>
  </head>
  <body>
    <div class="preview-root">${previewHTML}</div>
  </body>
</html>`;
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
