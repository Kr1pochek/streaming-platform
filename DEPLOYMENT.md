# Deployment Guide: Vercel + Railway

## Architecture
- **Frontend**: Vercel (static site - React/Vite)
- **Backend API**: Railway (Node.js + Express + PostgreSQL)

---

## Step 1: Deploy Backend to Railway

### 1.1 Create Railway Account
- Go to [railway.app](https://railway.app)
- Sign up / login with GitHub

### 1.2 Deploy Backend
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize and deploy
railway init
railway up
```

Or use Railway Dashboard UI:
- Create new project
- Select "Deploy from GitHub"
- Choose this repository
- Railway will detect `railway.json` automatically

### 1.3 Get Backend URL
After deployment:
- Go to Railway Dashboard
- Find your project
- Copy the public URL (usually something like: `https://your-project-name.up.railway.app`)
- Take note of this - you'll need it for Vercel

### 1.4 Configure Railway Environment Variables
In Railway Dashboard, set these variables:
```
DATABASE_URL=postgresql://user:password@host:port/dbname
PORT=3000 (or auto-assigned)
CORS_ORIGINS=https://your-vercel-domain.vercel.app
NODE_ENV=production
SERVE_CLIENT=false
```

> Get DATABASE_URL from Railway's PostgreSQL plugin or set it explicitly

---

## Step 2: Deploy Frontend to Vercel

### 2.1 Create Vercel Account
- Go to [vercel.com](https://vercel.com)
- Sign up / login with GitHub

### 2.2 Import Project
1. Click "Add New..." → "Project"
2. Select "Import Git Repository"
3. Choose your repository
4. Click "Import"

### 2.3 Configure Environment Variables
In Vercel Dashboard, go to Settings → Environment Variables:

Add:
```
VITE_API_URL=https://your-railway-backend-url
```

Example:
```
VITE_API_URL=https://streaming-platform-prod.up.railway.app
```

### 2.4 Configure Build Settings
- **Build Command**: `npm run build` ✓ (auto-detected)
- **Output Directory**: `dist` ✓ (auto-detected)
- **Install Command**: `npm ci` ✓ (default)

### 2.5 Deploy
Click "Deploy" - Vercel will:
1. Build your React app
2. Create optimized production bundle
3. Deploy to CDN
4. Provide URL: `https://your-project.vercel.app`

---

## Step 3: Update API Routes

### 3.1 Update CORS on Backend
In Railway Environment Variables, update:
```
CORS_ORIGINS=https://your-vercel-domain.vercel.app
```

Example:
```
CORS_ORIGINS=https://streaming-platform-pied.vercel.app
```

---

## Verification

### Test Frontend Build Locally
```bash
# Build frontend
npm run build

# Preview production build
npm run preview
```

### Test API Connectivity
1. Go to your Vercel deployment URL
2. Open browser DevTools (F12)
3. Check Network tab - API calls should go to Railway backend
4. No CORS errors should appear

### Check Logs
- **Vercel**: Dashboard → Deployments → View logs
- **Railway**: Dashboard → Logs tab

---

## Troubleshooting

### CORS Errors
- Check CORS_ORIGINS in Railway backend matches Vercel URL
- Don't forget `https://` prefix

### API Not Responding
- Verify Railway backend is running: visit `https://your-backend/api/health`
- Check `VITE_API_URL` in Vercel Environment Variables
- Redeploy Vercel after changing env vars

### Build Fails on Vercel
```bash
# Check build locally
npm run build

# Check for linting errors
npm run lint
```

### Database Connection Issues
- Verify DATABASE_URL is correct in Railway
- Check PostgreSQL service is running in Railway

---

## Environment Variables Summary

### Railway Backend (.env)
```
DATABASE_URL=postgresql://...
PORT=3000
NODE_ENV=production
CORS_ORIGINS=https://your-vercel-domain.vercel.app
SERVE_CLIENT=false
PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD (or use DATABASE_URL)
```

### Vercel Frontend
```
VITE_API_URL=https://your-railway-backend.up.railway.app
```

---

## Auto-Deploy on Push

Both platforms support auto-deployment:

### Vercel
- Automatically redeploys when you push to main branch
- Can configure production & preview branches in Settings

### Railway
- Automatically redeploys on every push (or main branch only)
- Configure in Railway Dashboard → Deployments

---

## Domain Setup (Optional)

### Custom Domain on Vercel
1. Vercel Dashboard → Settings → Domains
2. Add your custom domain
3. Update DNS records as instructed

### Custom Domain on Railway
- Can point to custom domain or use Railway's auto-assigned domain

---

## Cost Considerations

- **Vercel**: Free tier includes frontends
- **Railway**: Free tier includes $5 credits/month, can cover small PostgreSQL instance
- **Total**: Very affordable for small-medium projects

---

## Next Steps

1. ✅ Deploy backend to Railway
2. ✅ Get backend URL
3. ✅ Deploy frontend to Vercel with `VITE_API_URL` env var
4. ✅ Update CORS on Railway
5. ✅ Test both deployments
6. ✅ (Optional) Add custom domains
