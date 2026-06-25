@echo off
REM Pre-deployment verification script for Windows

echo.
echo 🔍 Checking deployment readiness...
echo.

setlocal enabledelayedexpansion
set PASSED=0
set FAILED=0

REM Check package.json
if exist package.json (
  echo ✓ package.json exists
  set /a PASSED+=1
) else (
  echo ✗ package.json not found
  set /a FAILED+=1
)

REM Check vite.config.js
if exist vite.config.js (
  echo ✓ vite.config.js exists
  set /a PASSED+=1
) else (
  echo ✗ vite.config.js not found
  set /a FAILED+=1
)

REM Check for VITE_API_URL in vite.config.js
findstr /M "VITE_API_URL" vite.config.js >nul
if %errorlevel%==0 (
  echo ✓ vite.config.js configured for VITE_API_URL
  set /a PASSED+=1
) else (
  echo ✗ vite.config.js missing VITE_API_URL setup
  set /a FAILED+=1
)

REM Check vercel.json
if exist vercel.json (
  echo ✓ vercel.json exists
  set /a PASSED+=1
) else (
  echo ⚠ vercel.json not found (will use defaults)
)

REM Check railway.json
if exist railway.json (
  echo ✓ railway.json exists
  set /a PASSED+=1
) else (
  echo ✗ railway.json not found
  set /a FAILED+=1
)

REM Check deployment docs
if exist DEPLOYMENT.md (
  echo ✓ DEPLOYMENT.md exists
  set /a PASSED+=1
)

if exist DEPLOY_CHECKLIST.md (
  echo ✓ DEPLOY_CHECKLIST.md exists
  set /a PASSED+=1
)

if exist QUICK_DEPLOY.md (
  echo ✓ QUICK_DEPLOY.md exists
  set /a PASSED+=1
)

REM Check dependencies
echo.
echo 🔧 Checking dependencies...
findstr /M "express" package.json >nul
if %errorlevel%==0 echo ✓ Express installed

findstr /M "react" package.json >nul
if %errorlevel%==0 echo ✓ React installed

findstr /M "pg" package.json >nul
if %errorlevel%==0 echo ✓ PostgreSQL driver installed

REM Check build
echo.
echo 📋 Testing build...
call npm run build >nul 2>&1
if %errorlevel%==0 (
  echo ✓ Build succeeds
  set /a PASSED+=1
  if exist dist (
    echo ✓ dist/ folder created
    set /a PASSED+=1
  )
) else (
  echo ✗ Build fails - fix errors before deploying
  set /a FAILED+=1
)

echo.
echo ====================================
echo Results:
echo   Passed: %PASSED%
echo   Failed: %FAILED%
echo ====================================

if %FAILED% equ 0 (
  echo.
  echo ✓ Ready to deploy!
  echo Next steps: Read QUICK_DEPLOY.md
  exit /b 0
) else (
  echo.
  echo ✗ Fix issues above before deploying
  exit /b 1
)
