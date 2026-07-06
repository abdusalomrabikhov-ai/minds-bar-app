# Заметки проекта TeamTask

Файл заметок по решениям и договорённостям проекта. Обновлять при значимых изменениях.

## Функциональность

- **Timesheet**: колонки "Премия" и "Аванс" — добавлены в БД, сервер, таблицу и форму.
- **Комментарии**: автокомплит по `@` (упоминания), панель эмодзи (кнопка 😊).

## UI-договорённости

- Диалоги удаления — только кастомная модалка в стиле приложения, никогда `confirm()`.
- Клик по оверлею модалки должен закрывать её только если `mousedown` начался на самом оверлее (не внутри контента) — иначе клик-драг из модалки наружу закрывает её случайно.
- `.btn-primary` требует `border: 1.5px solid transparent`, иначе высота не совпадает с `.btn-outline`.

## Кэш и деплой

- CSS **и JS** кэшируются через `?v=N` в `index.html` — бампать версию при каждом деплое изменений соответствующего файла, иначе правки не долетают до браузеров (assets кэшируются `immutable` на год). Текущие: `style.css?v=29`, `app.js?v=9`.
- Подробности деплоя — см. `DEPLOY.md`.
- Домен `bar.mindstech.io` подключён к Railway (CNAME + TXT verify записи в DNS mindstech.io).

## Инфраструктура

- SSE (`/api/events`) должен быть исключён из `compression()` middleware — gzip буферизует stream и рвёт realtime-доставку событий. Если добавляются новые global middleware в server.js — проверять, что они не оборачивают SSE-роут.
- **PWA**: manifest.json + иконки (192/512/apple-touch) готовы, устанавливается на Android/iOS. Мобильный safe-area (iPhone home indicator) требует `viewport-fit=cover` в viewport meta — без него `env(safe-area-inset-*)` всегда 0.
- **Desktop**: `desktop/` — Electron-обёртка, грузит прод-URL напрямую (не bundled статику). Обновления сервера подхватываются сами; пересборка `.dmg`/`.exe` (`cd desktop && npm run build`) нужна только при изменении самого `desktop/main.js`. `desktop/dist/` — build-артефакт, в `.gitignore`, не коммитится.

## Лог изменений

(новые записи сверху)

- 2026-07-06 — fix: мобильные модалки не реагировали на скролл — body scroll не блокировался при открытии, touch проваливался на контент под модалкой. openModal()/closeModal()/confirmDel() теперь блокируют/восстанавливают body.style.overflow. Добавлен -webkit-overflow-scrolling:touch на .modal. Заодно бампнуты cache-busting версии (app.js v=9, style.css v=29) — без этого правки не долетали до реальных браузеров.
- 2026-07-06 — fix: PWA-иконки (192/512/apple-touch) заменены на wordmark "minds bar" — старый equalizer-логотип заменён по просьбе юзера. Кроп: bbox текста + равный паддинг вокруг, центрировано на bbox (не на геометрический центр исходника — тот сам смещён вниз в оригинальном файле).
- 2026-07-06 — feat: PWA install-иконки (192/512/apple-touch), iOS safe-area fix (viewport-fit=cover + .page-content padding учитывает safe-area-inset-bottom), Electron desktop-обёртка (desktop/).
- 2026-07-06 — fix: SSE-события задерживались из-за глобального compression() middleware, буферизующего /api/events (задачи "на проверку" появлялись только после re-render страницы, не в реальном времени). Исключён /api/events из сжатия, refreshCurrentPage() теперь также освежает review-страницу при SSE reconnect.
- 2026-07-06 — fix: раздел "Задачи на проверку" не получал задачи для менеджеров без admin-роли (право review_tasks игнорировалось, gate проверял только role==='admin'). Три места в server.js: PUT /api/tasks/:id, PATCH /api/tasks/:id/my-done, добавлен helper userCan(). Подтверждено на реальном юзере (Пулатова Камилла, id=2).
- 2026-07-06 — добавлены DEPLOY.md, MEMORY.md, CLAUDE.md с правилом session-end логирования

---
Последнее обновление: 2026-07-06
