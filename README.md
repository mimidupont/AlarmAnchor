# ⚓ Anchor Alarm - Real-Time Boat Monitoring System

A real-time location-based alarm system for boats. Get instant notifications when your boat drifts outside a designated anchor zone. Monitor your boat from multiple phones simultaneously.

## 🎯 Features

- **✏️ Draw Custom Zones**: Define anchor zones directly on the map
- **📍 Real-Time Tracking**: GPS updates every 10 seconds
- **🚨 Instant Alerts**: Notifications + audio + vibration when boat leaves zone
- **👁️ Remote Monitoring**: Watch your boat from another phone anywhere
- **📡 Live Sync**: All connected devices get real-time updates
- **🌐 Works Online & Offline**: GPS tracking works without internet (remote requires internet)
- **🎨 Web-Based**: Test on Windows laptop, deploy to Android

## 🚀 Quick Start (Windows)

### 1. Install Requirements
- Node.js 14+ from [nodejs.org](https://nodejs.org/)

### 2. Start Backend (Terminal 1)
```bash
cd anchor-alarm-backend
npm install
npm start
# Backend runs on http://localhost:5000
```

### 3. Start Frontend (Terminal 2)
```bash
cd anchor-alarm-frontend
npm install
npm start
# App opens at http://localhost:3000
```

### 4. Test
- Open two browser windows
- Create session in window 1 (boat monitor)
- Join session in window 2 (remote monitor)
- Draw a zone on the map
- Simulate GPS movement (DevTools → Sensors)

**See [SETUP_AND_DEPLOYMENT.md](./SETUP_AND_DEPLOYMENT.md) for detailed instructions.**

## 📁 Project Structure

```
.
├── anchor-alarm-backend/       # Node.js + Socket.io server
│   ├── server.js
│   └── package.json
├── anchor-alarm-frontend/      # React web app
│   ├── src/
│   │   ├── App.jsx
│   │   └── components/
│   ├── public/
│   └── package.json
└── SETUP_AND_DEPLOYMENT.md     # Full setup guide
```

## 🏗️ Architecture

```
┌─────────────────┐                ┌─────────────────┐
│  Main App       │                │  Remote Monitor │
│  (Boat's Phone) │◄──────────────►│  (Any Phone)    │
│                 │   Socket.io    │                 │
│ • Draw Zone     │   Real-time    │ • View Location │
│ • GPS Tracking  │   Sync         │ • View Zone     │
│ • Alarm Trigger │                │ • Alarm Status  │
└────────┬────────┘                └────────┬────────┘
         │                                  │
         └──────────────┬───────────────────┘
                        │
                   ┌────▼─────┐
                   │ Backend   │
                   │ Node.js + │
                   │ Socket.io │
                   │           │
                   │ • Manage  │
                   │   sessions│
                   │ • Sync    │
                   │   data    │
                   │ • Detect  │
                   │   alerts  │
                   └───────────┘
```

## 🔌 How It Works

1. **Create Session**: Main app creates unique session ID
2. **Join Session**: Remote phones join using session ID
3. **Draw Zone**: Main app draws polygon on map
4. **Track Position**: GPS updates sent every 10 seconds
5. **Geofencing**: Backend checks if location inside polygon
6. **Alert**: If outside zone → notification + sound + vibration
7. **Sync**: All connected devices notified in real-time

## 🧪 Testing

### Local (Windows Browser)
- Simulate GPS in Chrome DevTools (F12 → Sensors)
- Simulate GPS in Firefox (Console → geolocation)

### Real Phone
- Deploy backend + frontend
- Open app on Android phone
- Real GPS coordinates used

### Both Devices
- Start main app on phone 1
- Start remote app on phone 2
- Changes sync instantly

## 📦 Dependencies

**Backend:**
- Express 4.18.2
- Socket.io 4.5.4
- CORS enabled

**Frontend:**
- React 18.2.0
- Leaflet 1.9.4 (maps)
- Leaflet-Draw 1.1.4 (zone drawing)
- Socket.io-client 4.5.4

## ☁️ Deployment

### Quick Deploy (Free Tier)
1. Backend → [Render.com](https://render.com) (Node.js)
2. Frontend → [Vercel.com](https://vercel.com) (React)
3. Takes ~5 minutes total

**See SETUP_AND_DEPLOYMENT.md for step-by-step instructions.**

## 🔒 Security

Current MVP has no authentication (anyone with Session ID can view). For production:

- [ ] Add user authentication
- [ ] Encrypt location data
- [ ] Use HTTPS only
- [ ] Add rate limiting
- [ ] Database for persistence

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Backend won't start | Port 5000 in use? Try: `PORT=5001 npm start` |
| Frontend can't connect | Check `.env` file has correct backend URL |
| GPS not working | Browser needs geolocation permission |
| Map not loading | Check Leaflet CSS imported (automatic) |
| Socket.io errors | Check backend running + CORS enabled |

## 🎮 Usage Guide

### For Boat Monitor (Main App)
1. Click "Create New Session"
2. Share Session ID with others
3. Draw anchor zone on map
4. GPS updates automatically
5. Get alert if boat leaves zone

### For Remote Monitor
1. Click "Join Session"
2. Paste Session ID
3. Watch boat position in real-time
4. See when boat enters/leaves zone
5. Get same alerts as boat phone

## 📊 Performance

- GPS polling: 10 seconds
- Zone sync: Real-time
- Location update: Real-time
- Memory: In-memory (cleaned every hour)
- Can handle 100+ simultaneous connections

## 🚀 Next Steps

1. **Develop locally** (Windows laptop)
2. **Deploy to cloud** (Render + Vercel)
3. **Test on Android**
4. **Add features** (notifications, history, etc)
5. **Deploy to Play Store** (if needed)

## 📄 License

MIT

## 👨‍💻 Development

Built with:
- Node.js + Express (backend)
- React 18 + Leaflet (frontend)
- Socket.io (real-time sync)
- OpenStreetMap (free maps)

---

**Questions?** See [SETUP_AND_DEPLOYMENT.md](./SETUP_AND_DEPLOYMENT.md) for comprehensive guide.

Happy sailing! ⚓🚤
