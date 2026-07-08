# Заметки проекта TeamTask

Файл заметок по решениям и договорённостям проекта. Обновлять при значимых изменениях.

## Функциональность

- **Timesheet**: колонки "Премия" и "Аванс" — добавлены в БД, сервер, таблицу и форму.
- **Комментарии**: автокомплит по `@` (упоминания), панель эмодзи (кнопка 😊).

## UI-договорённости

- Диалоги удаления — только кастомная модалка в стиле приложения, никогда `confirm()`. Применено везде в кодовой базе (2026-07-07): все 16 мест с нативным confirm() заменены на showConfirmModal().
- Клик по оверлею модалки должен закрывать её только если `mousedown` начался на самом оверлее (не внутри контента) — иначе клик-драг из модалки наружу закрывает её случайно.
- `.btn-primary` требует `border: 1.5px solid transparent`, иначе высота не совпадает с `.btn-outline`.

## Кэш и деплой

- CSS **и JS** кэшируются через `?v=N` в `index.html` — бампать версию при каждом деплое изменений соответствующего файла, иначе правки не долетают до браузеров (assets кэшируются `immutable` на год). Текущие: `style.min.css?v=38`, `app.min.js?v=23`.
- **Билд-шаг (с 2026-07-08)**: `public/js/app.js`/`public/css/style.css` — исходники, `index.html` грузит минифицированные `.min.js`/`.min.css` (esbuild, `npm run build`). После правки исходников — обязательно ребилд перед деплоем, иначе браузер видит старую минифицированную версию.
- Подробности деплоя — см. `DEPLOY.md`.
- Домен `bar.mindstech.io` подключён к Railway (CNAME + TXT verify записи в DNS mindstech.io).

## Инфраструктура

- SSE (`/api/events`) должен быть исключён из `compression()` middleware — gzip буферизует stream и рвёт realtime-доставку событий. Если добавляются новые global middleware в server.js — проверять, что они не оборачивают SSE-роут.
- **PWA**: manifest.json + иконки (192/512/apple-touch) готовы, устанавливается на Android/iOS. Мобильный safe-area (iPhone home indicator) требует `viewport-fit=cover` в viewport meta — без него `env(safe-area-inset-*)` всегда 0.
- **Desktop**: `desktop/` — Electron-обёртка, грузит прод-URL напрямую (не bundled статику). Обновления сервера подхватываются сами; пересборка `.dmg`/`.exe` (`cd desktop && npm run build`) нужна только при изменении самого `desktop/main.js`. `desktop/dist/` — build-артефакт, в `.gitignore`, не коммитится.
- **SQLite `LOWER()` — ASCII-only**, не лоуеркейзит кириллицу. Для case-insensitive сравнения кириллического текста в SQL использовать `lower_u()` (custom function, зарегистрирована в `database.js` через `db.function()`, backed by JS `.toLowerCase()`), не встроенный `LOWER()`.
- **Задачи**: одиночный исполнитель = обычный `tasks.status`, 2+ исполнителя = `task_assignees` (чеклист-формат, `PATCH .../my-done`). Любое место, меняющее статус на `done` (PUT, my-done, approve), должно вызывать `spawnRecurringTask()` — три существующих места уже это делают, если добавляется новый способ завершить задачу, не забыть про recurring.
- **Календарь**: повторяющиеся события — одна строка в БД, occurrences считаются на лету (`_calExpandRecurring`) и **все делят один и тот же `id`**. Любой код, работающий с конкретным occurrence (detail modal, delete, edit), обязан матчить по `id` **и** `start.dateTime` вместе — иначе всегда резолвится первое вхождение серии.
- **CORS**: применяется только к `/api/*` (с 2026-07-08), не глобально — статика (шрифты/JS/CSS) идёт мимо CORS-проверки, т.к. браузер шлёт font `url()` в cors-режиме даже same-origin, и глобальный CORS блокировал их без Origin в allowlist. Ограничен списком `ALLOWED_ORIGINS` в server.js (bar.mindstech.io + railway domain + localhost:3000/127.0.0.1:3000 только если `NODE_ENV!=='production'`). Запросы без Origin header (curl, Electron same-origin) всегда проходят. Новый клиентский домен — добавить в список.
- **Транзакции**: `db.transaction(fn)` доступна в database.js (better-sqlite3-style). Используется на project/task delete каскадах. Новые многошаговые DELETE/UPDATE — оборачивать так же.
- **Telegram**: `TELEGRAM_WEBHOOK_SECRET` опционален — если не задан в Railway, webhook работает без проверки secret token (backward-compat). Установить переменную = включить проверку без доп. кода.

## Лог изменений

(новые записи сверху)

- 2026-07-08 — perf: полный аудит производительности + PWA + новые виды календаря. Backend: CORS сужен до /api (глобальный CORS блокировал same-origin font-запросы — обнаружено при внедрении Gotham-шрифта), async bcrypt (было sync, блокировало event loop), N+1 в content-plan sync (batched deletes + shared project/members cache), 3 индекса (finance_history/push_subscriptions/finance_activity_log), TTL-кэш на dashboard/reports/best-employee/workload (20-30с, корректно scoped org vs per-user), LIMIT 2000 на /api/tasks?all=1. **Баг табеля**: timesheet_employees дублировался на каждой загрузке страницы (INSERT OR IGNORE без UNIQUE constraint на user_id — 97 строк вместо 18), почищено + partial UNIQUE INDEX добавлен, регрессия проверена (3 повторных вызова, всё ещё 18). Frontend: esbuild минификация (новый build.js, npm run build — index.html теперь грузит .min.js/.min.css, не исходники), Gotham 8×OTF/TTF (~1MB) → 2×WOFF2 (~106KB) через fonttools, debounce на task-search, PWA iOS meta+maskable icon+SW cache-first. Календарь: Day/4day/Week (единый time-grid renderer с новым overlap-алгоритмом, не переиспользует Month'овский assignSlot), Year (12 мини-месяцев), Agenda (список) — все 6 видов через один _calViewMode switch, независимый от старого _calTab (Календарь/Дежурства/Расписание). Задеплоено (commit b3049ce), проверено на bar.mindstech.io.
- 2026-07-07 — fix: полный security-аудит (16 находок), 4 коммита. Критично: IDOR в GET /api/tasks/:id (нет canAccessTask), XSS через title/name в 12 местах, удалён мёртвый seed-эндпоинт с реальными bcrypt-хешами 16 аккаунтов из исходников (git history не чистили — пароли стоит сменить отдельно). Важно: JWT_SECRET fatal вместо fallback, JWT 30d→7d, global error handler, DELETE user не падает с FK error, mobile touch targets 44px. Желательно: CORS ограничен, Telegram token TTL+webhook secret, транзакции на каскадных удалениях, 5 индексов добавлено. Cleanup: мёртвый Google OAuth код + googleapis зависимость удалены. Не сделано (по решению юзера): git history rewrite, GET /api/users permissions restriction, JWT invalidation по смене пароля, доп. mobile breakpoints (нужен визуальный проход). Полный отчёт был в отдельном Artifact.
- 2026-07-07 — fix: удаление occurrence повторяющегося календарного события ("это и все последующие") удаляло всю серию — openCalEventDetail() матчил только по id (все occurrences делят один id), всегда резолвя первое вхождение вместо того на которое кликнул юзер. Теперь матчит по id+start.dateTime.
- 2026-07-07 — fix: повторяющиеся задачи не спавнили следующую через checklist/approve пути (только через обычный PUT-статус) — вынесено в shared spawnRecurringTask(), вызывается из всех трёх мест. Root cause: одиночный исполнитель ошибочно создавал task_assignees запись — setTaskAssignees() теперь только для 2+ исполнителей. Побочный эффект пришлось чинить: одиночные задачи потеряли единственный способ отметить "готово" (кнопка рендерилась только для мульти) — добавлена toggleTaskDone() + кнопка в карточке/detail. Detail-модалка теперь закрывается сама при финальном статусе (done/pending_review), но не при частичном мульти-завершении. deleteTask/save-задачи теперь также обновляют страницу "Мои задачи" (раньше только "Все задачи").
- 2026-07-07 — fix: описание задачи/календарного события теряло переносы строк (нет white-space:pre-wrap на detail-view). Заодно task description теперь экранируется (_escHtml) — раньше вставлялся сырым, XSS-риск. Отдельно: убраны последние нативные confirm() (16 мест) в пользу showConfirmModal() — finance/kids/b2c удаление курса/студента, задачи, проекты, content-plan, расписание, feedback, telegram disconnect.
- 2026-07-06 — fix: глобальный поиск не находил задачи с заглавными кириллическими буквами (SQLite LOWER() не работает с не-ASCII). Зарегистрирована lower_u() unicode-aware функция, используется в /api/search вместо LOWER(). Проверено: заглавные↔строчные кириллица, смешанный регистр, ASCII без регрессии.
- 2026-07-06 — fix: мобильные модалки не реагировали на скролл — body scroll не блокировался при открытии, touch проваливался на контент под модалкой. openModal()/closeModal()/confirmDel() теперь блокируют/восстанавливают body.style.overflow. Добавлен -webkit-overflow-scrolling:touch на .modal. Заодно бампнуты cache-busting версии (app.js v=9, style.css v=29) — без этого правки не долетали до реальных браузеров.
- 2026-07-06 — fix: PWA-иконки (192/512/apple-touch) заменены на wordmark "minds bar" — старый equalizer-логотип заменён по просьбе юзера. Кроп: bbox текста + равный паддинг вокруг, центрировано на bbox (не на геометрический центр исходника — тот сам смещён вниз в оригинальном файле).
- 2026-07-06 — feat: PWA install-иконки (192/512/apple-touch), iOS safe-area fix (viewport-fit=cover + .page-content padding учитывает safe-area-inset-bottom), Electron desktop-обёртка (desktop/).
- 2026-07-06 — fix: SSE-события задерживались из-за глобального compression() middleware, буферизующего /api/events (задачи "на проверку" появлялись только после re-render страницы, не в реальном времени). Исключён /api/events из сжатия, refreshCurrentPage() теперь также освежает review-страницу при SSE reconnect.
- 2026-07-06 — fix: раздел "Задачи на проверку" не получал задачи для менеджеров без admin-роли (право review_tasks игнорировалось, gate проверял только role==='admin'). Три места в server.js: PUT /api/tasks/:id, PATCH /api/tasks/:id/my-done, добавлен helper userCan(). Подтверждено на реальном юзере (Пулатова Камилла, id=2).
- 2026-07-06 — добавлены DEPLOY.md, MEMORY.md, CLAUDE.md с правилом session-end логирования

---
Последнее обновление: 2026-07-08 (perf-аудит + календарь views, commit b3049ce — confirmed online на bar.mindstech.io)
