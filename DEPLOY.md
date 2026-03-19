# Chat App Deployment Guide

## Table of Contents

- [Local Development](#local-development)
- [Railway Deployment](#railway-deployment)
- [Render Deployment](#render-deployment)
- [Docker Deployment](#docker-deployment)
- [Frontend Build & Distribution](#frontend-build--distribution)
- [Important Reminders](#important-reminders)

---

## Local Development

### Prerequisites

- Node.js 18 or higher ([download](https://nodejs.org/))
- npm (included with Node.js)

### macOS / Linux

1. Open a terminal in the project root directory.
2. Make the start script executable (first time only):
   ```bash
   chmod +x start.sh
   ```
3. Run the start script:
   ```bash
   ./start.sh
   ```
4. The server will start at `http://localhost:3000`.

### Windows

1. Double-click `start.bat` in the project root, or open a Command Prompt and run:
   ```cmd
   start.bat
   ```
2. The server will start at `http://localhost:3000`.

### Manual Start

If you prefer to start manually:

```bash
cd server
cp .env.example .env   # First time only; then edit .env as needed
npm install
node app.js
```

---

## Railway Deployment

Railway provides a fast way to deploy Node.js applications with automatic builds.

### Steps

1. **Create a Railway account** at [railway.app](https://railway.app/) and sign in.

2. **Create a new project** by clicking "New Project" on the dashboard.

3. **Connect your GitHub repository**:
   - Select "Deploy from GitHub repo."
   - Authorize Railway to access your repository and select the chat-app repo.

4. **Configure environment variables**:
   - Go to the "Variables" tab in your service settings.
   - Add the following variables:
     - `PORT` = `3000`
     - `JWT_SECRET` = a strong random string (use a password generator)
     - `NODE_ENV` = `production`

5. **Set the root directory** (if the server is in a subdirectory):
   - Go to Settings and set the root directory to `server`.

6. **Deploy**:
   - Railway will automatically detect the `railway.json` configuration and the `Procfile`.
   - The build will start automatically. Monitor progress in the "Deployments" tab.

7. **Get your public URL**:
   - Go to Settings > Networking > "Generate Domain" to get a public URL.
   - Your API will be available at `https://your-app.up.railway.app`.

8. **Verify**: Visit `https://your-app.up.railway.app/health` to confirm the server is running.

---

## Render Deployment

Render is an alternative cloud platform with a generous free tier.

### Steps

1. **Create a Render account** at [render.com](https://render.com/) and sign in.

2. **Create a new Web Service**:
   - Click "New" > "Web Service."
   - Connect your GitHub repository.

3. **Configure the service**:
   - **Name**: `chat-app-server`
   - **Region**: Choose the closest region to your users.
   - **Branch**: `main` (or your default branch).
   - **Root Directory**: `server`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node app.js`

4. **Add environment variables**:
   - Click "Environment" and add:
     - `PORT` = `3000`
     - `JWT_SECRET` = a strong random string
     - `NODE_ENV` = `production`

5. **Create the service** and wait for the first deploy to complete.

6. **Get your URL**: Render provides a URL like `https://chat-app-server.onrender.com`.

7. **Verify**: Visit `https://chat-app-server.onrender.com/health`.

---

## Docker Deployment

### Using Docker Compose (Recommended)

1. Copy the environment template:
   ```bash
   cp server/.env.example .env
   ```
2. Edit `.env` and set a strong `JWT_SECRET`.

3. Build and start:
   ```bash
   docker-compose up -d
   ```

4. The server will be available at `http://localhost:3000`.

5. To stop:
   ```bash
   docker-compose down
   ```

### Using Docker Directly

1. Build the image:
   ```bash
   docker build -t chat-app .
   ```

2. Run the container:
   ```bash
   docker run -d \
     -p 3000:3000 \
     -e JWT_SECRET=your-strong-secret \
     -e NODE_ENV=production \
     -v chat-data:/app/data \
     --name chat-app \
     chat-app
   ```

3. To stop:
   ```bash
   docker stop chat-app
   ```

---

## Frontend Build & Distribution

The frontend is a uni-app project located in the `client/` directory. Use **HBuilderX** to build and distribute it.

### Development

1. Download and install [HBuilderX](https://www.dcloud.io/hbuilderx.html).
2. Open the `client/` folder as a project in HBuilderX.
3. Update the API base URL in the client configuration to point to your server:
   - For local development: `http://localhost:3000`
   - For production: your deployed server URL (e.g., `https://your-app.up.railway.app`)
4. Run on a simulator or connected device using HBuilderX's built-in tools.

### Building for Distribution

- **Android APK**: In HBuilderX, go to Build > App-Android (APK/AAB).
- **iOS IPA**: In HBuilderX, go to Build > App-iOS (IPA). Requires an Apple Developer account.
- **H5 (Web)**: In HBuilderX, go to Build > Website (H5). Deploy the generated files to any static hosting service.
- **鸿蒙 HarmonyOS**: 安装 [DevEco Studio](https://developer.huawei.com/consumer/cn/deveco-studio/)，在 HBuilderX 中选择 Build > 鸿蒙应用。
- **WeChat Mini Program**: In HBuilderX, go to Build > WeChat Mini Program. Then upload via WeChat DevTools.

---

## Important Reminders

1. **Change `JWT_SECRET`**: The default value in `.env.example` is a placeholder. Always generate a strong, unique secret for production. Use a command like:
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

2. **Update API URLs**: After deploying the server, update the API base URL in the client code to match your production server URL. Failing to do so will cause the app to try connecting to `localhost`.

3. **HTTPS**: Always use HTTPS in production. Railway and Render provide HTTPS by default. If self-hosting with Docker, place a reverse proxy (e.g., nginx, Caddy) in front of the server.

4. **Data Persistence**: The Docker setup uses a named volume (`chat-data`) for data persistence. Back up this volume regularly in production.

5. **Monitoring**: Check the `/health` endpoint periodically to ensure the server is running correctly.
