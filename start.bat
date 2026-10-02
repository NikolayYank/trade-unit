@echo off
rem Запуск Trade Unit двойным щелчком (Windows): ставит недостающее, собирает сайт, открывает http://localhost:4317
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Нужна версия 20.19 или новее: https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci || call npm install
)
start "" cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:4317"
call npm start
