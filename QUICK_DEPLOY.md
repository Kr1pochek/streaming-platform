# ⚡ Deploy in 15 minutes

This project is configured for easy deployment to **Vercel** (frontend) + **Railway** (backend).

## The Setup

```
┌─────────────┐         ┌──────────────┐        ┌────────────┐
│   Vercel    │◄────────►│   Railway    │◄──────►│ PostgreSQL │
│  (React UI) │  HTTPS   │  (API/Node)  │  SQL   │ (Database) │
└─────────────┘         └──────────────┘        └────────────┘
```

**Why split?**
- Vercel is perfect for static frontends (free, fast CDN)
- Railway handles backend + database (small, affordable)
- Everything stays connected via HTTPS API

---

## Quick Deploy

### 1️⃣ Deploy Backend (Railway) - 10 min

```bash
# Option A: Using Railway CLI
npm install -g @railway/cli
railway login
railway up

# Option B: Using Railway Dashboard
# 1. Go to railway.app
# 2. Create new project
# 3. Select "Deploy from GitHub"
# 4. Choose this repo → Deploy
# 5. Wait for ✓
```

After deployment:
- ✅ Copy your Railway URL: `https://your-project.up.railway.app`
- ✅ Keep browser tab open

---

### 2️⃣ Deploy Frontend (Vercel) - 5 min

```bash
# Option A: Vercel CLI
npm install -g vercel
vercel
# Answer prompts, it will auto-configure

# Option B: Using Vercel Dashboard
# 1. Go to vercel.com
# 2. Click "Add New..." → "Project"
# 3. Import this GitHub repo
# 4. ⚠️ Before Deploy:
#    - Go to Environment Variables
#    - Add: VITE_API_URL = https://your-railway-app.up.railway.app
# 5. Click Deploy
# 6. Wait for ✓
```

After deployment:
- ✅ Copy your Vercel URL: `https://your-app.vercel.app`

---

### 3️⃣ Update Backend CORS - 1 min

Go to Railway Dashboard:
1. Select your project
2. Settings → Environment Variables
3. Update: `CORS_ORIGINS=https://your-app.vercel.app`
4. Redeploy (should auto-trigger)

---

## ✅ Test It

1. Open `https://your-app.vercel.app` in browser
2. Open DevTools: `F12` → Console tab
3. No red errors? ✓
4. Try using the app (search, play music, etc.)

---

## 📋 What Got Set Up

✅ **vercel.json** - Vercel build configuration
✅ **vite.config.js** - Updated to use `VITE_API_URL` env var
✅ **railway.json** - Railway deployment config (already existed)
✅ **.env.vercel** - Template for Vercel env vars
✅ **.env.production.example** - Template for Railway env vars
✅ **DEPLOYMENT.md** - Full deployment guide
✅ **DEPLOY_CHECKLIST.md** - Step-by-step checklist

---

## 🔧 Environment Variables

### Railway Backend
```
DATABASE_URL=postgresql://...     # From Railway PostgreSQL plugin
PORT=3000
NODE_ENV=production
CORS_ORIGINS=https://your-vercel-app.vercel.app
SERVE_CLIENT=false
TRUST_PROXY=true
```

### Vercel Frontend
```
VITE_API_URL=https://your-railway-app.up.railway.app
```

---

## 🚀 After First Deploy

**Auto-Deploy On Push:**
Just push to GitHub! Both platforms auto-redeploy:
- Vercel: 1-2 minutes
- Railway: 2-3 minutes

**No manual deployments needed anymore!**

---

## ❓ Common Issues

| Issue | Solution |
|-------|----------|
| **App loads but no data** | Check `VITE_API_URL` in Vercel env vars |
| **CORS errors in console** | Update `CORS_ORIGINS` in Railway to match Vercel URL |
| **API returns 404** | Verify `https://your-railway-app.up.railway.app/api/health` returns OK |
| **Build fails on Vercel** | Run `npm run build` locally to check for errors |

---

## 📖 Full Guides

- Long version: [DEPLOYMENT.md](DEPLOYMENT.md)
- Checklist: [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md)

---

## 💰 Cost

- **Vercel**: Free for frontends
- **Railway**: Free tier includes $5/month (covers small PostgreSQL + Node.js)
- **Total**: ~$5/month or completely free on free tiers

---

**Ready to deploy? Start with the checklist:** [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md)
