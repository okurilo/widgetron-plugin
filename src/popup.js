const statusEl = document.getElementById("status");
const originEl = document.getElementById("origin");
const messageEl = document.getElementById("message");
const domainBadge = document.getElementById("domainBadge");
const captureBadge = document.getElementById("captureBadge");
const armedToggle = document.getElementById("armedToggle");
const startButton = document.getElementById("startButton");
const copyButton = document.getElementById("copyButton");
const viewerButton = document.getElementById("viewerButton");
const clearButton = document.getElementById("clearButton");

let popupState = null;

armedToggle.addEventListener("change", async () => {
  setMessage("Обновляю настройки домена...");
  setBusy(true);

  const result = await chrome.runtime.sendMessage({
    type: "SET_DOMAIN_ARMED",
    armed: armedToggle.checked
  });

  if (!result?.ok) {
    setMessage(result?.error || "Не удалось изменить режим.");
    await refreshState();
    return;
  }

  setMessage(armedToggle.checked ? "Сбор включён. Вкладка перезагружается." : "Сбор выключен. Вкладка перезагружается.");
  await refreshState();
});

startButton.addEventListener("click", async () => {
  setMessage("Запускаю выбор элемента...");
  const result = await chrome.runtime.sendMessage({ type: "START_CAPTURE" });
  if (!result?.ok) {
    setMessage(result?.error || "Не удалось запустить выбор.");
    return;
  }

  setMessage("Выбор элемента запущен.");
  window.close();
});

copyButton.addEventListener("click", async () => {
  const stored = await chrome.storage.local.get("latestCapture");
  if (!stored.latestCapture) {
    setMessage("Сохранять пока нечего.");
    await refreshState();
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(stored.latestCapture, null, 2));
    setMessage("Захват скопирован.");
  } catch {
    setMessage("Не удалось скопировать.");
  }
});

viewerButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_RECEIVER" });
  setMessage("Viewer открыт.");
});

clearButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_LATEST_CAPTURE" });
  setMessage("Данные очищены.");
  await refreshState();
});

void refreshState();

async function refreshState() {
  setBusy(true);
  popupState = await chrome.runtime.sendMessage({ type: "GET_POPUP_STATE" });
  renderState();
  setBusy(false);
}

function renderState() {
  const isSupported = Boolean(popupState?.isSupportedPage);
  const isArmed = Boolean(popupState?.isArmed);
  const hasLatestCapture = Boolean(popupState?.hasLatestCapture);

  const originText = popupState?.origin ? simplifyOrigin(popupState.origin) : "Неподдерживаемая вкладка";

  originEl.textContent = popupState?.origin || "Неподдерживаемая вкладка";
  domainBadge.textContent = originText;
  captureBadge.textContent = isArmed ? "Сбор включён" : "Сбор выключен";
  captureBadge.className = `badge ${isArmed ? "badge--active" : "badge--muted"}`;
  armedToggle.checked = isArmed;
  armedToggle.disabled = !isSupported;
  startButton.disabled = !isSupported || !isArmed;
  copyButton.disabled = !hasLatestCapture;
  clearButton.disabled = !hasLatestCapture;

  if (!isSupported) {
    statusEl.textContent = "Откройте обычную страницу по http или https.";
    viewerButton.disabled = false;
    return;
  }

  statusEl.textContent = isArmed
    ? "Сбор включён для этого домена."
    : "Сбор выключен для этого домена.";
  viewerButton.disabled = false;
}

function setBusy(isBusy) {
  armedToggle.disabled = isBusy || !popupState?.isSupportedPage;
  startButton.disabled = isBusy || !popupState?.isSupportedPage || !popupState?.isArmed;
  copyButton.disabled = isBusy || !popupState?.hasLatestCapture;
  viewerButton.disabled = isBusy;
  clearButton.disabled = isBusy || !popupState?.hasLatestCapture;
}

function setMessage(text) {
  messageEl.textContent = text;
}

function simplifyOrigin(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
