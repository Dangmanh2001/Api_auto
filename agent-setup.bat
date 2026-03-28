@echo off
chcp 65001 > nul
title Flow Agent Setup

echo ====================================
echo   FLOW AGENT - SETUP & CHAY
echo ====================================
echo.

REM Kiem tra Node.js
node --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Chua co Node.js!
    echo Vui long tai va cai Node.js tai: https://nodejs.org
    echo Chon phien ban LTS, cai xong chay lai file nay.
    pause
    exit
)

echo [OK] Node.js da duoc cai dat
echo.

REM Cai packages neu chua co
if not exist "node_modules" (
    echo Dang cai packages, vui long cho...
    npm install
    echo.
)

REM Nhap IP server
echo Nhap dia chi server (mac dinh: http://192.168.1.89:3000)
set /p SERVER_URL="Server URL: "
if "%SERVER_URL%"=="" set SERVER_URL=http://192.168.1.89:3000

echo.
echo Dang ket noi toi: %SERVER_URL%
echo.
echo ====================================
echo  Agent dang chay - de tat bam Ctrl+C
echo ====================================
echo.

node agent.js %SERVER_URL%
pause
