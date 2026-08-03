# Anchor Alarm - Setup & Deployment Guide

## 📋 Project Structure

```
anchor-alarm-backend/
├── server.js          # Express server with Socket.io
├── package.json       # Dependencies
└── README.md

anchor-alarm-frontend/
├── src/
│   ├── App.jsx       # Main app component
│   ├── App.css
│   ├── components/
│   │   ├── SessionManager.jsx
│   │   ├── Map.jsx
│   │   ├── RemoteMonitor.jsx
│   │   ├── AlarmNotification.jsx
│   │   └── [component styles]
│   ├── index.jsx
│   └── index.css
├── public/
│   └── index.html
├── package.json
└── .env.example
```

---

## 🚀 Local Development (Windows + Testing)

### Prerequisites
- Node.js 14+ ([download](https://nodejs.org/))
- npm (comes with Node.js)
- Git (optional, for version control)

### Step 1: Setup Backend

```bash
# Navigate to backend folder
cd anchor-alarm-backend

# Install dependencies
npm install

# Start development server
npm start
# Backend runs on http://localhost:5000
```

**Backend Console Output:**
```
Anchor Alarm server running on port 5000
```

### Step 2: Setup Frontend

**Open a NEW terminal window/tab** (keep backend running)

```bash
# Navigate to frontend folder
cd anchor-alarm-frontend

# Install dependencies
npm install

# Create .env file from template
cp .env.example .env

# Start development server
npm start
# Frontend opens at http://localhost:3000
```

**Frontend Console Output:**
```
webpack compiled successfully
Compiled successfully!
To create a production build, run npm run build.
Webpack is watching the files…
```

### Step 3: Test on Windows Browser

1. Open **two browser windows** on your Windows laptop
2. Go to `http://localhost:3000` in both

**Window 1: Main App (Boat Monitor)**
- Click "Create New Session"
- Wait for GPS location to update
- Draw a polygon zone on the map
- Copy the Session ID

**Window 2: Remote Monitor**
- Click "Join Session"
- Paste the Session ID
- Watch the boat position update in real-time

### Simulating GPS (Browser Dev Tools)

Since you're testing on Windows without a real phone:

1. **Chrome DevTools → Sensors Tab**
   - Press `F12` → Go to "Sensors" tab
   - Simulate location manually
   - Change latitude/longitude to test zone crossing

2. **Firefox DevTools → Geolocation**
   - Open Inspector → Console
   - Use: `navigator.geolocation.getCurrentPosition(pos => console.log(pos))`

**Alternative: Use Android Emulator**
- Download [Android Studio](https://developer.android.com/studio)
- Run emulator with "Extended controls → Location"
- Test app through mobile browser

---

## 📱 Android Deployment

### Option A: Web App (Fastest)

1. Deploy backend and frontend (see below)
2. Open browser on Android phone
3. Go to deployed URL
4. Bookmark as home screen app

### Option B: Native App (Recommended for Production)

Use **Expo** to convert React app to Android APK:

```bash
# Install Expo CLI
npm install -g expo-cli

# In frontend folder
cd anchor-alarm-frontend
npx create-expo-app .

# Add Socket.io to Expo
npm install socket.io-client expo-location

# Build APK
expo build:android

# Download APK and install on phone
```

---

## ☁️ Production Deployment

### Option 1: Fly.io + Vercel (what this project actually uses)

#### Deploy Backend → Fly.io

The full, current instructions live in
[`anchor-alarm-backend/DEPLOY_FLY.md`](anchor-alarm-backend/DEPLOY_FLY.md).
In short:

```bash
cd anchor-alarm-backend
fly auth login
fly launch --copy-config --no-deploy    # uses the committed fly.toml
fly volumes create anchor_data --region cdg --size 1   # once, SAME region
fly deploy
fly scale count 1                       # exactly ONE machine, always
curl https://<your-app>.fly.dev/health
```

Why Fly rather than a generic Node host: one always-on `shared-cpu-1x` /
256 MB machine with no cold start (an alarm relay must not be waking up when
the first fix arrives), native WebSocket support, and a volume for the
session snapshot.

> ⚠️ **Never `fly scale count 2`.** Sessions live in that machine's memory
> and on its own volume; a second machine would receive joins for sessions
> it can neither find nor read.

#### Deploy Frontend

1. In `anchor-alarm-frontend` folder, update `.env.production`:
   ```
   REACT_APP_BACKEND_URL=https://<your-app>.fly.dev
   REACT_APP_FRONTEND_URL=https://<your-frontend>.vercel.app
   ```

2. Go to [vercel.com](https://vercel.com)
3. Sign up (free tier available)
4. Click "Add New..." → "Project"
5. Import your GitHub repo
6. Configure:
   - **Framework Preset**: React
   - **Build Command**: `npm run build`
   - **Output Directory**: `build`
7. Add Environment Variable:
   - Key: `REACT_APP_BACKEND_URL`
   - Value: your Fly backend URL
8. Click "Deploy"

Your app is now live! 🎉

After changing the backend origin, add the new frontend origin to the
backend's CORS allowlist — otherwise the browser build is blocked:

```bash
fly secrets set ALLOWED_ORIGINS="https://<your-frontend>.vercel.app,https://<your-frontend>-*.vercel.app,capacitor://localhost,http://localhost"
```

> ⚠️ **Setting `ALLOWED_ORIGINS` replaces the built-in list, it does not add
> to it.** Anything you leave out is blocked. Include the `-*` preview
> pattern above: Vercel gives every deployment its own hostname
> (`<project>-<hash>-<scope>.vercel.app`) and only aliases the newest one to
> the bare name, so a tester who opens a preview link is on an origin the
> bare name does not cover.
>
> This failure is easy to misread. The APK keeps working — native HTTP
> stacks send no `Origin` header, so they are never subject to the check —
> while a browser opening the same session shows the picker and never
> reaches the map. If a remote monitor works in the app but not in a
> browser, check `fly logs` for `[cors] rejected origin …` first.

### Option 2: Self-Hosted (AWS/DigitalOcean)

```bash
# Backend (Node.js)
ssh ubuntu@your-server-ip

# Install Node
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and run
git clone your-repo
cd anchor-alarm-backend
npm install
npm start  # Or use PM2 for auto-restart

# Frontend (Static build)
cd ../anchor-alarm-frontend
npm run build
# Upload /build folder to web server (nginx/Apache)
```

---

## 🧪 Testing Checklist

- [ ] Backend running locally on port 5000
- [ ] Frontend running locally on port 3000
- [ ] Can create new session on one browser tab
- [ ] Can join session on another browser tab
- [ ] Can draw zone on map
- [ ] Zone syncs to remote monitor
- [ ] GPS position updates every 10 seconds
- [ ] Alarm triggers when boat leaves zone
- [ ] Notification and sound work
- [ ] Can acknowledge alarm
- [ ] Session ID copies correctly
- [ ] Works on Android browser

---

## 🔧 Troubleshooting

### Backend won't start
```bash
# Check if port 5000 is in use
lsof -i :5000
# Kill process: kill -9 <PID>
# Or change port: PORT=5001 npm start
```

### Frontend can't connect to backend
- Check backend URL in `.env` file
- Ensure backend is running
- Check browser console for CORS errors
- Backend CORS is already configured for all origins

### GPS not working
- Browser needs HTTPS for geolocation (except localhost)
- On deployed site, use HTTPS URL
- Check browser location permissions

### Socket.io connection fails
- Check backend is running and accessible
- Verify CORS configuration
- Check browser console for specific errors

### Leaflet map not rendering
- Check Leaflet CSS is loaded (should be automatic)
- Ensure map container has height: 100%
- Open browser DevTools → check for console errors

---

## 📊 Performance Notes

- **GPS Polling**: 10 seconds (configurable in App.jsx)
- **Zone Sync**: Real-time via Socket.io
- **Location Sync**: Real-time to all connected clients
- **Memory**: in-memory sessions, expiring after **24 h of inactivity** —
  not 1 h after creation, which used to delete overnight anchor watches
- **Persistence**: the session Map is snapshotted to `$DATA_DIR/sessions.json`
  every 30 s and on shutdown, and read back at boot, so a restart or a
  `fly deploy` does not lose active anchor watches
- **Scalability**: a shared store (Redis) is only worth it past a few hundred
  concurrent sessions; at beta size (~40 sockets) it would just conflict with
  the volume

---

## 🔒 Security Considerations

### Current (MVP)
- No authentication
- Anyone with Session ID can monitor

### For Production
1. Add user authentication:
   ```javascript
   // Add JWT tokens in socket.io connection
   socket.handshake.auth.token
   ```

2. Encrypt location data:
   ```bash
   npm install crypto
   ```

3. Rate limiting:
   ```bash
   npm install express-rate-limit
   ```

4. Use HTTPS only (mandatory for geolocation on production)

---

## 📱 Android App Store Submission

Once working as web app:

1. Create privacy policy
2. Build proper APK via Expo/React Native
3. Create app icons and screenshots
4. Sign up for Google Play Developer ($25)
5. Upload APK and metadata
6. Submit for review (~48 hours)

---

## 📞 Support

For issues:
1. Check console errors (F12)
2. Verify backend is running
3. Ensure frontend `.env` has correct backend URL
4. Check network tab to see Socket.io handshake

---

## 🎯 Next Steps

1. **Test locally** on Windows browser
2. **Deploy to Fly.io + Vercel** (takes 5 minutes)
3. **Test on Android phone**
4. **Add authentication** (optional)
5. **Add database persistence** (optional)
6. **Submit to Play Store** (if needed)

Happy sailing! ⚓
