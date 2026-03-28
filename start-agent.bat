@echo off
title Flow Agent
color 0A

echo ==================================================
echo   FLOW AGENT - Khoi dong tu dong
echo ==================================================
echo.

:: Kiem tra Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Chua cai Node.js!
    echo Vui long tai va cai tai: https://nodejs.org
    echo.
    pause
    start https://nodejs.org
    exit /b
)

echo [OK] Node.js da duoc cai dat
echo.

:: Cai package neu chua co
if not exist "node_modules\axios" (
    echo [...] Dang cai axios...
    npm install axios >nul 2>&1
    echo [OK] Da cai axios
)

if not exist "node_modules\puppeteer-real-browser" (
    echo [...] Dang cai puppeteer-real-browser (co the mat 1-2 phut)...
    npm install puppeteer-real-browser
    echo [OK] Da cai puppeteer-real-browser
)

echo.
echo ==================================================
echo   Ket noi toi server: http://192.168.1.89:3000
echo ==================================================
echo.
echo Lan dau Chrome se mo de dang nhap Google (1 lan duy nhat).
echo Sau do Chrome se tu dong chay ngam.
echo.
echo De dung agent: bam Ctrl+C
echo.

node agent.js http://192.168.1.89:3000

pause
