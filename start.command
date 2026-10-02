#!/bin/bash
# Запуск Trade Unit двойным щелчком (macOS) или командой `bash start.command` (Linux).
# Ставит недостающее, собирает сайт и открывает его в браузере на http://localhost:4317.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Не найден Node.js. Нужна версия 20.19 или новее: https://nodejs.org"
  read -r -p "Нажмите Enter, чтобы закрыть..." _
  exit 1
fi
[ -d node_modules ] || npm ci || npm install
( sleep 5; (command -v open >/dev/null 2>&1 && open http://localhost:4317) || (command -v xdg-open >/dev/null 2>&1 && xdg-open http://localhost:4317) ) &
npm start
