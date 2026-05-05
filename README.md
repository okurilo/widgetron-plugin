# Vorovayka MVP

Минимальный MV3-прототип расширения Chrome для:

- выбора DOM-узла на странице
- сбора ограниченного DOM snapshot
- захвата последних релевантных `fetch`/`XHR`
- выбора до 5 запросов пользователем
- передачи данных через `chrome.storage.local.latestCapture`
- явного включения capture только на выбранном домене
- popup-меню для включения/выключения capture и копирования результата

## Как проверить

1. Откройте `chrome://extensions`.
2. Включите `Developer mode`.
3. Нажмите `Load unpacked` и выберите корень проекта.
4. Откройте `chrome-extension://<extension-id>/src/viewer.html`.
5. На целевом домене откройте popup расширения.
6. Включите toggle `Сбор сети на домене`: вкладка перезагрузится, и после этого ранние `fetch`/`XHR` начнут попадать в ring buffer.
7. Нажмите `Выбрать DOM-элемент` в popup или используйте `Ctrl+Shift+Y`.
8. Подтвердите выбранные запросы в модальном окне.
9. После capture используйте `Скопировать latestCapture` или `Открыть viewer`.

## Что входит в MVP

- DOM snapshot: `outerHTML`, `innerText`, `rect`, `dataset`, `aria`, `role`, ограниченные computed styles
- Network capture: ring buffer `N=30`
- Фильтрация: убираются `OPTIONS`, analytics/telemetry и статические ресурсы
- Ограничения: HTML до `50KB`, response body до `100KB`, не более `5` запросов
- Безопасность: capture включается только на armed-доменах, может быть выключен из popup, channel page→content изолирован случайным именем события, чувствительные заголовки и очевидные токены редактируются, `latestCapture` очищается после чтения и автоудаляется по TTL

## Что сознательно не покрыто

- сложная корреляция DOM ↔ API
- DevTools/CDP/WebSocket/GraphQL
- устойчивость ко всем типам навигации и edge-case SPA
- production-grade защита от всех видов секретов внутри произвольных text response body
