# Деплой TeamTask

Стек: Node.js >=22, Express, SQLite (`teamtask.db`), хостинг — Railway (builder: NIXPACKS).

## Команда деплоя

```bash
./deploy.sh
```

Скрипт — обёртка над `railway up --detach`.

**Важно:** деплой (`railway up`) запускать только по явной команде юзера. Не деплоить проактивно после правок.

## Перед деплоем

- Прогнать тесты: `npx playwright test`
- Если менялся CSS **или JS** в `public/` — бампнуть `?v=N` в `index.html` для соответствующего файла (кэш-бастинг, assets кэшируются `immutable` на год). Текущие версии: `style.css?v=29`, `app.js?v=9`
- Проверить, что `server.js` стартует локально (`npm start`) без ошибок

## После деплоя

```bash
railway logs --tail   # логи в реальном времени
railway status        # статус деплоя
railway open           # открыть сайт в браузере
```

## Конфиг

- `railway.toml`: `startCommand = "node server.js"`, restart policy — ON_FAILURE, max 3 retries
- `package.json`: `start` → `node server.js`, `dev` → `nodemon server.js`
- Домен: `bar.mindstech.io` (CNAME → Railway) подключён к сервису minds-bar-app

## Deploy log

(новые записи сверху)

- 2026-07-07 — fix: удаление occurrence повторяющегося календарного события ("это и все последующие") удаляло всю серию. Root cause: все occurrences повторяющегося события расширяются на лету с одинаковым id — openCalEventDetail(eventId) матчил только по id, всегда резолвя первое вхождение независимо от того на какую дату кликнул юзер. Теперь матчит по id+start.dateTime (commit ac7656b). app.js?v=15. Задеплоено, Online.
- 2026-07-07 — fix: повторяющиеся задачи не спавнили следующую через checklist (my-done) и approve-пути, только через обычный PUT-статус — вынесено в shared spawnRecurringTask(). Root cause: одиночный исполнитель ошибочно создавал task_assignees запись (мультизадачный формат), теряя обычный статус-flow — setTaskAssignees() теперь только для 2+. Добавлена кнопка "Готово" для одиночных задач (toggleTaskDone), автозакрытие detail-модалки при финальном статусе, deleteTask/save-задачи теперь обновляют и страницу "Мои задачи" (commit 7c58b9d). app.js?v=14. Задеплоено, Online.
- 2026-07-07 — fix: описание задачи/календарного события теряло переносы строк при отображении (white-space:pre-wrap отсутствовал) — также экранирование добавлено для task description (не было вообще, XSS-риск). Отдельно: все 16 мест с нативным browser confirm() заменены на кастомную модалку showConfirmModal() — финансы Kids/B2C (удаление курса/студента), задачи, проекты, content-plan, расписание, feedback, telegram (commit e6f26eb). app.js?v=11. Задеплоено, Online.
- 2026-07-06 — fix: глобальный поиск (/api/search) не находил задачи с заглавными кириллическими буквами в названии — SQLite LOWER() ASCII-only, не лоуеркейзит кириллицу. Добавлена unicode-aware SQL-функция lower_u() (commit c0c5985). Задеплоено, Online.
- 2026-07-06 — fix: мобильные модалки не реагировали на скролл (touch проваливался на body под модалкой) — body.style.overflow теперь блокируется/восстанавливается при открытии/закрытии. Также бампнуты cache-busting версии app.js (v=9) и style.css (v=29) — раньше правки от сегодняшних более ранних фиксов не долетали до браузеров из-за immutable-кэша (commit 3f323e1). Задеплоено, Online.
- 2026-07-06 — fix: PWA-иконки заменены на wordmark-лого "minds bar" вместо старого equalizer-логотипа (commit 4903d37). Задеплоено, Online.
- 2026-07-06 — feat: PWA install icons (192/512/apple-touch), iOS safe-area fix (viewport-fit=cover), Electron desktop wrapper добавлен (commit b6f9d9d). desktop/ не деплоится на сервер — только public/+server.js. Задеплоено, Online.
- 2026-07-06 — fix: SSE-события (в т.ч. "Задачи для проверки") задерживались из-за глобального compression() middleware, буферизовавшего /api/events. Исключён из сжатия + refreshCurrentPage() теперь освежает страницу review (commit 0468d47). Задеплоено, Online на bar.mindstech.io.
- 2026-07-06 — fix: review-gate игнорировал review_tasks permission, проверял только role==='admin' (commit 724f2c2). Деплой на Railway (minds-bar-app), билд запущен.
- 2026-07-06 — создан DEPLOY.md/MEMORY.md, деплоя не было
