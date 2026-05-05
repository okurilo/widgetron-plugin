const NETWORK_EVENT = "__VOROVAYKA_NETWORK_EVENT__";
const ARMED_ORIGINS_KEY = "armedOrigins";
const MAX_HTML_CHARS = 50 * 1024;
const MAX_TEXT_CHARS = 12 * 1024;
const MAX_RESPONSE_CHARS = 100 * 1024;
const MAX_BUFFER_SIZE = 30;
const MAX_CANDIDATES = 5;
const POST_CLICK_WINDOW_MS = 1500;
const UI_ROOT_ID = "vorovayka-root";

const networkBuffer = [];
const channelToken = createChannelToken();
const scopedNetworkEvent = `${NETWORK_EVENT}:${channelToken}`;

let injected = false;
let captureEnabled = false;
let selectionActive = false;
let hoverEl = null;
let selectedEl = null;
let selectionStartedAt = 0;
let interactionTimestamp = 0;
let finalizeTimer = null;
let uiRoot = null;
let highlightBox = null;
let modal = null;

window.addEventListener("message", handlePageMessage);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "START_CAPTURE") {
    if (!captureEnabled) {
      ensureUi();
      renderHint("Сбор сети на этом домене выключен. Нажмите иконку расширения, чтобы включить его и перезагрузить страницу.");
      return;
    }

    startSelection();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[ARMED_ORIGINS_KEY]) {
    return;
  }

  const next = changes[ARMED_ORIGINS_KEY].newValue;
  captureEnabled = isOriginArmed(next);
});

void initializeCapture();

async function initializeCapture() {
  const stored = await chrome.storage.local.get(ARMED_ORIGINS_KEY);
  captureEnabled = isOriginArmed(stored[ARMED_ORIGINS_KEY]);

  if (captureEnabled) {
    injectPageScript();
  }
}

function injectPageScript() {
  if (injected) {
    return;
  }

  if (!document.documentElement) {
    document.addEventListener("readystatechange", injectPageScript, { once: true });
    return;
  }

  injected = true;
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("src/injected.js");
  script.dataset.eventName = scopedNetworkEvent;
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

function handlePageMessage(event) {
  if (
    !captureEnabled ||
    event.source !== window ||
    !event.data ||
    event.data.type !== scopedNetworkEvent
  ) {
    return;
  }

  const record = normalizeNetworkRecord(event.data.payload);
  if (!record) {
    return;
  }

  networkBuffer.push(record);
  if (networkBuffer.length > MAX_BUFFER_SIZE) {
    networkBuffer.shift();
  }
}

function normalizeNetworkRecord(payload) {
  if (!payload || typeof payload.url !== "string") {
    return null;
  }

  const method = String(payload.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    return null;
  }

  const url = payload.url;
  if (isBlacklistedUrl(url) || isStaticAsset(url)) {
    return null;
  }

  const contentType = String(payload.contentType || "").toLowerCase();
  if (!isAllowedContentType(contentType)) {
    return null;
  }

  const responseBody = truncateText(String(payload.responseBody || ""), MAX_RESPONSE_CHARS);

  return {
    id: payload.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    url,
    method,
    status: Number(payload.status) || 0,
    timestamp: Number(payload.timestamp) || Date.now(),
    contentType,
    responseBody,
    bodyTooLarge: Boolean(payload.bodyTooLarge || responseBody.length >= MAX_RESPONSE_CHARS),
    requestHeaders: sanitizeHeaders(payload.requestHeaders),
    responseHeaders: sanitizeHeaders(payload.responseHeaders)
  };
}

function startSelection() {
  if (selectionActive) {
    return;
  }

  ensureUi();
  selectionActive = true;
  selectedEl = null;
  hoverEl = null;
  selectionStartedAt = Date.now();
  renderHint("Выберите элемент на странице. Esc — отмена.");
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("keydown", onKeyDown, true);
}

function stopSelection() {
  selectionActive = false;
  hoverEl = null;
  renderHighlight(null);
  document.removeEventListener("pointermove", onPointerMove, true);
  document.removeEventListener("click", onClickCapture, true);
  document.removeEventListener("keydown", onKeyDown, true);
}

function onPointerMove(event) {
  if (!selectionActive) {
    return;
  }

  const target = getSelectableTarget(event.target);
  if (target === hoverEl) {
    return;
  }

  hoverEl = target;
  renderHighlight(target);
}

function onClickCapture(event) {
  if (!selectionActive) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const target = getSelectableTarget(event.target);
  if (!target) {
    return;
  }

  selectedEl = target;
  interactionTimestamp = Date.now();
  stopSelection();
  renderHint("Собираю DOM и недавние запросы...");

  clearTimeout(finalizeTimer);
  finalizeTimer = window.setTimeout(() => {
    showSelectionDialog(buildCapturePayload(target));
  }, POST_CLICK_WINDOW_MS);
}

function onKeyDown(event) {
  if (event.key !== "Escape") {
    return;
  }

  clearTimeout(finalizeTimer);
  stopSelection();
  closeModal();
  destroyUi();
}

function getSelectableTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  if (uiRoot?.contains(target)) {
    return null;
  }

  return target;
}

function buildCapturePayload(target) {
  const dom = captureDomSnapshot(target);
  const candidates = rankRequests(dom.innerText, interactionTimestamp);

  return {
    createdAt: new Date().toISOString(),
    page: {
      url: location.href,
      title: document.title
    },
    interaction: {
      type: "click",
      timestamp: interactionTimestamp || selectionStartedAt
    },
    dom,
    networkCandidates: candidates
  };
}

function captureDomSnapshot(target) {
  const rect = target.getBoundingClientRect();
  const styles = getComputedStyle(target);
  const dataset = {};
  const aria = {};

  Object.entries(target.dataset || {}).forEach(([key, value]) => {
    dataset[key] = truncateText(String(value), 500);
  });

  Array.from(target.attributes).forEach((attribute) => {
    if (attribute.name.startsWith("aria-")) {
      aria[attribute.name] = truncateText(attribute.value, 500);
    }
  });

  return {
    tagName: target.tagName.toLowerCase(),
    outerHTML: truncateText(target.outerHTML || "", MAX_HTML_CHARS),
    innerText: truncateText(target.innerText || target.textContent || "", MAX_TEXT_CHARS),
    role: target.getAttribute("role") || "",
    dataset,
    aria,
    rect: {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height)
    },
    computedStyle: {
      display: styles.display,
      position: styles.position,
      width: styles.width,
      height: styles.height,
      color: styles.color,
      font: styles.font
    }
  };
}

function rankRequests(domText, eventTs) {
  const normalizedDomText = normalizeText(domText);
  const scored = networkBuffer.map((record, index) => {
    let score = 0;
    const isAfterInteraction = eventTs > 0 && record.timestamp >= eventTs;
    const isRecent = index >= Math.max(0, networkBuffer.length - 5);
    const textMatch = normalizedDomText && record.responseBody
      ? normalizeText(record.responseBody).includes(normalizedDomText.slice(0, 160))
      : false;

    if (isAfterInteraction) {
      score += 5;
    }
    if (isRecent) {
      score += 2;
    }
    if (record.bodyTooLarge) {
      score -= 2;
    }
    if (textMatch) {
      score += 5;
    }

    return {
      ...record,
      score,
      reasons: {
        afterInteraction: isAfterInteraction,
        recent: isRecent,
        textMatch
      }
    };
  });

  const postInteraction = scored
    .filter((record) => eventTs > 0 && record.timestamp >= eventTs)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_CANDIDATES);

  const fallback = scored
    .slice(-MAX_CANDIDATES)
    .sort((a, b) => b.timestamp - a.timestamp);

  const selected = postInteraction.length > 0 ? postInteraction : fallback;
  const preselectedIds = new Set(
    selected
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return b.timestamp - a.timestamp;
      })
      .slice(0, Math.min(3, selected.length))
      .map((record) => record.id)
  );

  return selected.map((record) => ({
    ...record,
    preselected: preselectedIds.has(record.id)
  }));
}

function showSelectionDialog(payload) {
  ensureUi();
  closeModal();

  modal = document.createElement("div");
  modal.className = "vorovayka-modal";

  const heading = document.createElement("div");
  heading.className = "vorovayka-modal__heading";
  heading.textContent = "Выберите запросы для передачи";

  const summary = document.createElement("div");
  summary.className = "vorovayka-modal__summary";
  summary.textContent = `${payload.networkCandidates.length} кандидатов, максимум 5`;

  const list = document.createElement("div");
  list.className = "vorovayka-modal__list";

  if (payload.networkCandidates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "vorovayka-modal__empty";
    empty.textContent = "Подходящих JSON/text запросов не найдено. Можно отправить только DOM snapshot.";
    list.appendChild(empty);
  }

  payload.networkCandidates.forEach((candidate, index) => {
    const label = document.createElement("label");
    label.className = "vorovayka-modal__item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(candidate.preselected);
    checkbox.dataset.index = String(index);

    const meta = document.createElement("div");
    meta.className = "vorovayka-modal__meta";
    meta.innerHTML = [
      `<strong>${escapeHtml(candidate.method)} ${escapeHtml(shortenUrl(candidate.url))}</strong>`,
      `<span>Status ${candidate.status || "?"} · score ${candidate.score}</span>`
    ].join("");

    label.appendChild(checkbox);
    label.appendChild(meta);
    list.appendChild(label);
  });

  const actions = document.createElement("div");
  actions.className = "vorovayka-modal__actions";

  const sendButton = document.createElement("button");
  sendButton.textContent = "Передать";
  sendButton.addEventListener("click", async () => {
    const selected = Array.from(list.querySelectorAll("input[type='checkbox']:checked"))
      .map((input) => payload.networkCandidates[Number(input.dataset.index)])
      .slice(0, MAX_CANDIDATES)
      .map(stripTransientFields);

    await chrome.storage.local.set({
      latestCapture: {
        createdAt: payload.createdAt,
        page: payload.page,
        interaction: payload.interaction,
        dom: payload.dom,
        network: selected
      }
    });
    await chrome.runtime.sendMessage({ type: "SCHEDULE_CAPTURE_EXPIRY" });

    renderHint("Capture сохранён в chrome.storage.local как latestCapture");
    closeModal();
  });

  const openReceiverButton = document.createElement("button");
  openReceiverButton.textContent = "Открыть соседнюю вкладку";
  openReceiverButton.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "OPEN_RECEIVER" });
  });

  const cancelButton = document.createElement("button");
  cancelButton.textContent = "Закрыть";
  cancelButton.addEventListener("click", () => {
    closeModal();
    destroyUi();
  });

  actions.append(sendButton, openReceiverButton, cancelButton);
  modal.append(heading, summary, list, actions);
  uiRoot.appendChild(modal);
}

function stripTransientFields(record) {
  return {
    url: record.url,
    method: record.method,
    status: record.status,
    timestamp: record.timestamp,
    contentType: record.contentType,
    responseBody: record.responseBody,
    requestHeaders: record.requestHeaders,
    responseHeaders: record.responseHeaders
  };
}

function ensureUi() {
  if (uiRoot?.isConnected) {
    return;
  }

  uiRoot = document.createElement("div");
  uiRoot.id = UI_ROOT_ID;
  uiRoot.innerHTML = `
    <style>
      #${UI_ROOT_ID} {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${UI_ROOT_ID} .vorovayka-highlight {
        position: fixed;
        border: 2px solid #ff7a18;
        background: rgba(255, 122, 24, 0.12);
        pointer-events: none;
        z-index: 2147483645;
      }
      #${UI_ROOT_ID} .vorovayka-hint {
        position: fixed;
        top: 16px;
        right: 16px;
        max-width: 360px;
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.96);
        color: #fff;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        z-index: 2147483646;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
      }
      #${UI_ROOT_ID} .vorovayka-modal {
        position: fixed;
        right: 16px;
        bottom: 16px;
        width: 420px;
        max-width: calc(100vw - 32px);
        max-height: 70vh;
        overflow: auto;
        padding: 16px;
        border-radius: 14px;
        background: #fff;
        color: #0f172a;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
        z-index: 2147483647;
      }
      #${UI_ROOT_ID} .vorovayka-modal__heading {
        font-size: 15px;
        font-weight: 700;
        margin-bottom: 6px;
      }
      #${UI_ROOT_ID} .vorovayka-modal__summary,
      #${UI_ROOT_ID} .vorovayka-modal__empty {
        color: #475569;
        margin-bottom: 12px;
      }
      #${UI_ROOT_ID} .vorovayka-modal__list {
        display: grid;
        gap: 8px;
      }
      #${UI_ROOT_ID} .vorovayka-modal__item {
        display: grid;
        grid-template-columns: 18px 1fr;
        gap: 10px;
        align-items: start;
        padding: 10px;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
      }
      #${UI_ROOT_ID} .vorovayka-modal__meta strong,
      #${UI_ROOT_ID} .vorovayka-modal__meta span {
        display: block;
      }
      #${UI_ROOT_ID} .vorovayka-modal__meta span {
        color: #64748b;
      }
      #${UI_ROOT_ID} .vorovayka-modal__actions {
        display: flex;
        gap: 8px;
        margin-top: 14px;
      }
      #${UI_ROOT_ID} button {
        border: 0;
        border-radius: 10px;
        padding: 9px 12px;
        cursor: pointer;
        background: #0f172a;
        color: #fff;
        font: inherit;
      }
      #${UI_ROOT_ID} button:last-child {
        background: #e2e8f0;
        color: #0f172a;
      }
    </style>
    <div class="vorovayka-hint"></div>
    <div class="vorovayka-highlight" hidden></div>
  `;

  document.documentElement.appendChild(uiRoot);
  highlightBox = uiRoot.querySelector(".vorovayka-highlight");
}

function destroyUi() {
  if (uiRoot?.isConnected) {
    uiRoot.remove();
  }
  uiRoot = null;
  highlightBox = null;
  modal = null;
}

function renderHint(text) {
  ensureUi();
  const hint = uiRoot.querySelector(".vorovayka-hint");
  if (hint) {
    hint.textContent = text;
  }
}

function renderHighlight(element) {
  if (!highlightBox) {
    return;
  }

  if (!element) {
    highlightBox.hidden = true;
    return;
  }

  const rect = element.getBoundingClientRect();
  highlightBox.hidden = false;
  highlightBox.style.left = `${rect.left}px`;
  highlightBox.style.top = `${rect.top}px`;
  highlightBox.style.width = `${rect.width}px`;
  highlightBox.style.height = `${rect.height}px`;
}

function closeModal() {
  if (modal?.isConnected) {
    modal.remove();
  }
  modal = null;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key]) => !isSensitiveHeaderName(key))
      .map(([key, value]) => [key, truncateText(String(value), 500)])
  );
}

function isAllowedContentType(contentType) {
  return contentType.includes("application/json") || contentType.startsWith("text/");
}

function isBlacklistedUrl(url) {
  return /(analytics|telemetry|sentry|metrics|\/log\b|\/track\b)/i.test(url);
}

function isStaticAsset(url) {
  return /\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|map)(?:$|\?)/i.test(url);
}

function truncateText(value, limit) {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n...[truncated]`;
}

function shortenUrl(url) {
  if (url.length <= 80) {
    return url;
  }
  return `${url.slice(0, 77)}...`;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function isOriginArmed(armedOrigins) {
  return Boolean(armedOrigins && armedOrigins[location.origin]);
}

function isSensitiveHeaderName(name) {
  return /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i.test(String(name || ""));
}

function createChannelToken() {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16)).join("");
}
