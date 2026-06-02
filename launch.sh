#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo "  CPR Radar — storiesbyachu"
echo "  ──────────────────────────"

# Kill anything on port 3748
lsof -ti:3748 | xargs kill -9 2>/dev/null

# Install only production deps (express + node-fetch, no electron)
if [ ! -d "node_modules/express" ] || [ ! -d "node_modules/node-fetch" ]; then
  echo "  📦 Installing..."
  npm install --production --ignore-scripts 2>/dev/null
fi

echo "  ✓ Starting at http://localhost:3748"
echo "  ✓ Chrome will open automatically"
echo ""

node src/server.js
