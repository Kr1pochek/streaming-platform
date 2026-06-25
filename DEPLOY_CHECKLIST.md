# Quick Deploy Checklist

## Before Deploying

- [ ] Have GitHub account and repository pushed
- [ ] Have Railway account created (railway.app)
- [ ] Have Vercel account created (vercel.com)

## Step 1: Backend Deployment (Railway) - 10 minutes

- [ ] Open [railway.app](https://railway.app)
- [ ] Create new project → "Deploy from GitHub"
- [ ] Select your repository
- [ ] Railway auto-detects `railway.json` - click Deploy
- [ ] Wait for deployment ✓
- [ ] Go to Settings → Environment tab
- [ ] Add `DATABASE_URL=postgresql://...` or use Railway's PostgreSQL plugin
- [ ] Copy public URL: `https://your-railway-app.up.railway.app`
- [ ] Update `CORS_ORIGINS=https://your-vercel-app.vercel.app` (you'll do this after step 2)

**Test**: Open `https://your-railway-app.up.railway.app/api/health`
Should return `OK` or similar.

## Step 2: Frontend Deployment (Vercel) - 5 minutes

- [ ] Open [vercel.com](https://vercel.com)
- [ ] Click "Add New..." → "Project"
- [ ] "Import Git Repository" → select your repo
- [ ] Go to "Environment Variables"
- [ ] Add: `VITE_API_URL` = `https://your-railway-app.up.railway.app`
- [ ] Click "Deploy"
- [ ] Wait for build & deployment ✓
- [ ] Copy Vercel URL: `https://your-app.vercel.app`

## Step 3: Update Backend CORS

- [ ] Go back to Railway Dashboard
- [ ] Update `CORS_ORIGINS=https://your-app.vercel.app`
- [ ] Redeploy Railway (should be automatic, or use Deploy button)

## Verification

- [ ] Open your Vercel URL in browser
- [ ] App loads without errors
- [ ] Open DevTools (F12)
- [ ] Check Network tab - no CORS errors
- [ ] Try using app features (search, play, etc.)
- [ ] Check logs for errors

## You're Done! 🎉

Your app is now live:
- Frontend: `https://your-app.vercel.app`
- Backend API: `https://your-railway-app.up.railway.app/api`
- Database: PostgreSQL on Railway

### Quick Links for Future Reference

- Vercel Dashboard: https://vercel.com/dashboard
- Railway Dashboard: https://railway.app/dashboard
- View logs: Railway → Logs tab, Vercel → Deployments → View logs

### Redeploy on Changes

Just push to GitHub! Both platforms auto-deploy on push:
- Frontend redeploys on Vercel within 1-2 minutes
- Backend redeploys on Railway within 2-3 minutes

---

## Troubleshooting

**App not loading?**
- Check browser DevTools (F12) → Console for errors
- Check Vercel logs: Dashboard → Deployments → View logs

**API errors?**
- Visit `https://your-railway-app.up.railway.app/api/health` directly
- Check Railway logs for errors
- Verify `VITE_API_URL` matches your Railway URL

**Still stuck?**
- See full guide: [DEPLOYMENT.md](DEPLOYMENT.md)
