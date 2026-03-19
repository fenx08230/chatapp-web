@echo off
echo ===============================
echo   Chat App - Local Start Script
echo ===============================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo Node.js version: %%i
echo.

:: Navigate to server directory
cd /d "%~dp0server"

:: Install dependencies
echo Installing server dependencies...
call npm install

:: Copy .env.example to .env if .env doesn't exist
if not exist .env (
    echo Creating .env from .env.example...
    copy .env.example .env
    echo WARNING: Please edit server\.env and change JWT_SECRET before going to production!
    echo.
)

:: Start the server
echo Starting server on port 3000...
echo.
echo ===============================
echo   Server is running!
echo ===============================
echo.
echo API available at: http://localhost:3000
echo.
echo --- Frontend Setup ---
echo 1. Open the client\ folder in HBuilderX
echo 2. Update the API base URL in client\ to point to http://localhost:3000
echo 3. Run the app on a simulator or device from HBuilderX
echo.

node app.js
pause
