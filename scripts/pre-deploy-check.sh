#!/bin/bash
# Pre-deployment verification script

echo "🔍 Checking deployment readiness...\n"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counter
PASSED=0
FAILED=0

# Helper functions
check_pass() {
  echo -e "${GREEN}✓${NC} $1"
  ((PASSED++))
}

check_fail() {
  echo -e "${RED}✗${NC} $1"
  ((FAILED++))
}

check_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

# Checks
echo "📦 Dependencies..."
if [ -f package.json ]; then
  check_pass "package.json exists"
else
  check_fail "package.json not found"
fi

echo "\n🏗️  Build configuration..."
if [ -f vite.config.js ]; then
  check_pass "vite.config.js exists"
else
  check_fail "vite.config.js not found"
fi

if grep -q "VITE_API_URL" vite.config.js; then
  check_pass "vite.config.js configured for VITE_API_URL"
else
  check_fail "vite.config.js missing VITE_API_URL setup"
fi

if [ -f vercel.json ]; then
  check_pass "vercel.json exists"
else
  check_warn "vercel.json not found (will use defaults)"
fi

echo "\n🚀 Deployment configs..."
if [ -f railway.json ]; then
  check_pass "railway.json exists"
else
  check_fail "railway.json not found"
fi

if [ -f .env.example ]; then
  check_pass ".env.example exists"
fi

if [ -f .env.production.example ]; then
  check_pass ".env.production.example exists"
fi

echo "\n📝 Documentation..."
if [ -f DEPLOYMENT.md ]; then
  check_pass "DEPLOYMENT.md exists"
fi

if [ -f DEPLOY_CHECKLIST.md ]; then
  check_pass "DEPLOY_CHECKLIST.md exists"
fi

if [ -f QUICK_DEPLOY.md ]; then
  check_pass "QUICK_DEPLOY.md exists"
fi

echo "\n🔧 API configuration..."
if grep -r "import.meta.env.VITE_API_URL" src/ 2>/dev/null | grep -q "."; then
  check_pass "Frontend uses VITE_API_URL environment variable"
else
  check_warn "Frontend might not use VITE_API_URL (check src/api/)"
fi

if grep -q "express" package.json; then
  check_pass "Express installed"
fi

if grep -q "react" package.json; then
  check_pass "React installed"
fi

if grep -q "pg" package.json; then
  check_pass "PostgreSQL driver installed"
fi

echo "\n📋 Build test..."
if npm run build >/dev/null 2>&1; then
  check_pass "Build succeeds (npm run build)"
  if [ -d dist ]; then
    check_pass "dist/ folder created"
  fi
else
  check_fail "Build fails - fix errors before deploying"
fi

echo "\n🎯 Results\n"
echo "Tests passed: ${GREEN}$PASSED${NC}"
echo "Tests failed: ${RED}$FAILED${NC}"

if [ $FAILED -eq 0 ]; then
  echo -e "\n${GREEN}✓ Ready to deploy!${NC}"
  echo -e "Next steps: Read QUICK_DEPLOY.md"
  exit 0
else
  echo -e "\n${RED}✗ Fix issues above before deploying${NC}"
  exit 1
fi
