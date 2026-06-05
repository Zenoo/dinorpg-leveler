@echo off
cd /d "%~dp0"

if not exist "node_modules" (
    echo node_modules not found, running npm install...
    pnpm install
    if errorlevel 1 (
        echo.
        echo ERROR: npm install failed. Is Node.js installed?
        echo Download it from https://nodejs.org
        pause
        exit /b 1
    )
)

start "DinoRPG Auto-Leveler" cmd /k "cd /d "%~dp0" && pnpm run start"