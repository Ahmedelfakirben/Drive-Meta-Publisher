@echo off
title 2S1M Drive-Meta-Publisher
echo =======================================================
echo  🚗 Arrancando 2S1M Drive-Meta-Publisher...
echo =======================================================
echo.

:: Instalar dependencias si no existen
if not exist "node_modules\" (
    echo [1/2] Instalando dependencias de Node.js...
    call npm install
)

echo [2/2] Iniciando servicio y programador...
echo Abrir panel en el navegador: http://localhost:3050
start http://localhost:3050
npm start
pause
