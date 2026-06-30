#!/bin/bash
set -e

cd ~/Claude\ projects/teamtask

echo "Деплой TeamTask на Railway..."
railway up --detach

echo ""
echo "Готово! Проверить статус:"
echo "  railway logs --tail   — логи в реальном времени"
echo "  railway status        — статус деплоя"
echo "  railway open          — открыть сайт в браузере"
