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
- Если менялся CSS — бампнуть `?v=N` в `index.html` (кэш-бастинг), текущая версия v=3
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

- 2026-07-06 — feat: PWA install icons (192/512/apple-touch), iOS safe-area fix (viewport-fit=cover), Electron desktop wrapper добавлен (commit b6f9d9d). desktop/ не деплоится на сервер — только public/+server.js. Задеплоено, Online.
- 2026-07-06 — fix: SSE-события (в т.ч. "Задачи для проверки") задерживались из-за глобального compression() middleware, буферизовавшего /api/events. Исключён из сжатия + refreshCurrentPage() теперь освежает страницу review (commit 0468d47). Задеплоено, Online на bar.mindstech.io.
- 2026-07-06 — fix: review-gate игнорировал review_tasks permission, проверял только role==='admin' (commit 724f2c2). Деплой на Railway (minds-bar-app), билд запущен.
- 2026-07-06 — создан DEPLOY.md/MEMORY.md, деплоя не было
