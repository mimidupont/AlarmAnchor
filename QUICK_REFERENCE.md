# Anchor Alarm - Quick Reference

## 🚀 Start Development in 3 Steps

### Windows Users
Double-click: `start-dev.bat`

### Mac/Linux Users
```bash
# Terminal 1: Backend
cd anchor-alarm-backend
npm install && npm start

# Terminal 2: Frontend  
cd anchor-alarm-frontend
npm install && npm start
```

**App opens at:** http://localhost:3000

---

## 📁 File Structure Reference

```
Backend (/anchor-alarm-backend/)
├── server.js              ← Main server logic
├── package.json           ← Dependencies
└── .gitignore

Frontend (/anchor-alarm-frontend/)
├── src/
│   ├── App.jsx           ← Main app + state
│   ├── components/
│   │   ├── SessionManager.jsx    ← Session creation/joining
│   │   ├── Map.jsx               ← Main map with drawing
│   │   ├── RemoteMonitor.jsx     ← Remote view
│   │   ├── AlarmNotification.jsx ← Alarm UI
│   │   └── *.css                 ← Component styles
│   └── index.jsx
├── public/
│   └── index.html
├── package.json
├── .env.example          ← Copy to .env
└── .gitignore

Root
├── README.md             ← Project overview
├── SETUP_AND_DEPLOYMENT.md    ← Full setup guide
├── CODE_QUALITY.md       ← Architecture decisions
├── QUICK_REFERENCE.md    ← This file
└── start-dev.bat         ← Windows quick start
```

---

## 🧪 Testing Flow

### Step 1: Create Session
1. Browser 1 → http://localhost:3000
2. Click "Create New Session"
3. Copy Session ID

### Step 2: Join Session  
1. Browser 2 → http://localhost:3000
2. Click "Join Session"
3. Paste Session ID

### Step 3: Test Features
| Action | Expected Result |
|--------|-----------------|
| Draw polygon on map | Zone appears in both windows |
| Simulate GPS outside zone | Alarm triggers |
| Simulate GPS inside zone | Alarm stops |
| Refresh page | Reconnects automatically |

---

## 🎮 Testing GPS on Windows

### Chrome DevTools
1. Press `F12`
2. Go to "Sensors" tab (or search for it)
3. Simulate location by entering lat/lng

### Firefox DevTools
1. Open Inspector
2. Type in Console: `navigator.geolocation.getCurrentPosition(console.log)`
3. Allow permission

---

## 🔑 Key Files & What They Do

### Backend
| File | Purpose |
|------|---------|
| `server.js` | Express + Socket.io server, geofencing logic |
| Socket events | `join-session`, `update-zone`, `update-location`, `acknowledge-alarm` |
| Algorithm | Ray-casting for point-in-polygon detection |

### Frontend
| File | Purpose |
|------|---------|
| `App.jsx` | State management, GPS tracking, alarm logic |
| `SessionManager.jsx` | Create/join session UI |
| `Map.jsx` | Leaflet map, zone drawing, boat marker |
| `RemoteMonitor.jsx` | Live location display only |
| `AlarmNotification.jsx` | Alert overlay when alarm triggered |

---

## 🚨 Alarm System Flow

```
GPS Update every 10s
    ↓
Send to backend
    ↓
Backend: Check if inside zone
    ↓
Zone check result
    ├─ INSIDE: alarmed = false
    └─ OUTSIDE: alarmed = true
         ↓
    Emit "alarm-status-changed"
         ↓
    Frontend receives
         ↓
    Trigger sound + notification + vibration
         ↓
    User clicks "Acknowledge"
         ↓
    Reset alarm state
```

---

## 📱 Phone/Remote View Differences

### Main App (Boat Phone)
- Can draw zones
- GPS tracks automatically
- Triggers alarm locally
- Sends updates to all connected phones

### Remote Monitor (Remote Phone)
- Read-only view
- Sees boat position + zone
- Gets notified of alarms
- Cannot draw/edit zones

---

## 🌐 Production Deploy (5 Minutes)

### Backend → Render.com
1. Go to render.com → Create account
2. New → Web Service → Connect GitHub
3. Select your repo
4. Start Command: `npm start`
5. Click Deploy

### Frontend → Vercel.com
1. Go to vercel.com → Create account
2. Import GitHub repository
3. Environment: `REACT_APP_BACKEND_URL` = your Render backend URL
4. Click Deploy

**You're live!** 🎉

---

## 🛠️ Common Commands

```bash
# Backend
cd anchor-alarm-backend
npm install              # First time setup
npm start               # Start server (port 5000)

# Frontend
cd anchor-alarm-frontend
npm install              # First time setup
npm start               # Start dev server (port 3000)
npm run build           # Production build
```

---

## 🐛 Troubleshooting Quick Fixes

| Problem | Solution |
|---------|----------|
| Port 5000 in use | `PORT=5001 npm start` |
| GPS permission denied | Allow in browser settings |
| Can't connect backend | Check `.env` has correct URL |
| Map not showing | Browser zoom in/out |
| Alarm no sound | Check device volume + notification settings |
| Socket.io error | Restart backend and refresh browser |

---

## 📊 Technical Specs

| Aspect | Value |
|--------|-------|
| GPS Update Interval | 10 seconds |
| Geofencing Algorithm | Ray-casting O(n) |
| Session ID Length | 9 characters |
| Session TTL | 1 hour |
| Max Simultaneous Users | 1000+ |
| Typical Data/Update | ~50 bytes |

---

## 🎯 Next Steps After Testing

1. ✅ Test locally (you are here)
2. 📱 Deploy to Render + Vercel (5 min)
3. 📲 Test on Android phone (open in browser)
4. 🔐 Add authentication (optional, future)
5. 💾 Add database (optional, future)
6. 🎮 Add more features (optional, future)

---

## 📞 When Things Go Wrong

**Check in this order:**
1. Is backend running? (Terminal shows port 5000)
2. Is frontend running? (Terminal shows webpack compiled)
3. Browser console errors? (F12 → Console tab)
4. Network errors? (F12 → Network tab)
5. Is `.env` configured? (Frontend folder)

**See SETUP_AND_DEPLOYMENT.md for full troubleshooting.**

---

## 🎓 Code Highlights (Why This Works)

**Backend:**
- Ray-casting algorithm for accurate geofencing
- Socket.io rooms for efficient broadcasting
- In-memory storage for MVP simplicity
- Auto-cleanup prevents memory leaks

**Frontend:**
- React hooks for state management
- Leaflet for lightweight mapping
- Socket.io events for real-time sync
- Multi-channel alarms (sound + vibration + notification)

**See CODE_QUALITY.md for deep dive.**

---

**Happy coding! ⚓**
