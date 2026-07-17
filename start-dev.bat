@echo off
REM Anchor Alarm - Quick Start Script for Windows

echo.
echo ====================================
echo   ANCHOR ALARM - Development Setup
echo ====================================
echo.

REM Check if Node.js is installed
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please download and install from: https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js is installed: 
node -v
echo.

REM Setup Backend
echo [1/4] Installing backend dependencies...
cd anchor-alarm-backend
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install backend dependencies
    pause
    exit /b 1
)
cd ..
echo Backend setup complete!
echo.

REM Setup Frontend
echo [2/4] Installing frontend dependencies...
cd anchor-alarm-frontend
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install frontend dependencies
    pause
    exit /b 1
)

REM Create .env if it doesn't exist
if not exist .env (
    echo [3/4] Creating .env file...
    copy .env.example .env
    echo .env file created!
) else (
    echo [3/4] .env file already exists, skipping...
)
cd ..
echo.

echo ====================================
echo   Setup Complete!
echo ====================================
echo.
echo NEXT STEPS:
echo.
echo 1. Open TWO Command Prompt windows
echo.
echo 2. In FIRST window, run:
echo    cd anchor-alarm-backend
echo    npm start
echo.
echo 3. In SECOND window, run:
echo    cd anchor-alarm-frontend
echo    npm start
echo.
echo 4. Frontend will open automatically at: http://localhost:3000
echo    Backend runs at: http://localhost:5000
echo.
echo 5. Open http://localhost:3000 in TWO browser windows:
echo    - Window 1: Click "Create New Session" (boat monitor)
echo    - Window 2: Click "Join Session" and paste Session ID
echo.
echo For detailed instructions, see: SETUP_AND_DEPLOYMENT.md
echo.
pause
