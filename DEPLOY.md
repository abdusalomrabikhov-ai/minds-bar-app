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

## Deploy log

(новые записи сверху)

- 2026-07-06 — fix: review-gate игнорировал review_tasks permission, проверял только role==='admin' (commit 724f2c2). Деплой на Railway (minds-bar-app), билд запущен.
- 2026-07-06 — создан DEPLOY.md/MEMORY.md, деплоя не было
