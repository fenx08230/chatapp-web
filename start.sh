#!/usr/bin/env bash
set -e

echo "==============================="
echo "  Chat App - Local Start Script"
echo "==============================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

echo "Node.js version: $(node -v)"
echo ""

# Navigate to server directory and install dependencies
echo "Installing server dependencies..."
cd "$(dirname "$0")/server"
npm install

# Copy .env.example to .env if .env doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "WARNING: Please edit server/.env and change JWT_SECRET before going to production!"
    echo ""
fi

# Start the server in the background
echo "Starting server on port ${PORT:-3000}..."
node app.js &
SERVER_PID=$!
echo "Server started (PID: $SERVER_PID)"

echo ""
echo "==============================="
echo "  Server is running!"
echo "==============================="
echo ""
echo "API available at: http://localhost:${PORT:-3000}"
echo ""
echo "--- Frontend Setup ---"
echo "1. Open the client/ folder in HBuilderX"
echo "2. Update the API base URL in client/ to point to http://localhost:${PORT:-3000}"
echo "3. Run the app on a simulator or device from HBuilderX"
echo ""
echo "Press Ctrl+C to stop the server."

# Wait for the server process so Ctrl+C works
wait $SERVER_PID
