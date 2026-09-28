@echo off
chcp 65001 >nul
rem Запуск помощника CS2 Check на Windows (двойной щелчок).
cd /d "%~dp0"
if not exist node_modules (
  echo Устанавливаем зависимости...
  call npm install --no-audit --no-fund || goto :err
)
node server.js
pause
exit /b
:err
echo Не удалось установить зависимости. Установлен ли Node.js 20+? https://nodejs.org/ru
pause
