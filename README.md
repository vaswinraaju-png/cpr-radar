# CPR Radar — storiesbyachu

CPR level alert dashboard + MT4 auto-trading system.

## Deploy to Railway
1. Push this repo to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Select this repo → Railway auto-detects Node.js
4. Add env vars: PORT (Railway sets automatically)
5. Deploy → get your URL

## MT4 EA Setup
1. Copy CPR_Radar_EA.mq4 to MT4/MQL4/Experts/
2. MT4 → Tools → Options → Expert Advisors:
   - Allow automated trading
   - Allow WebRequest → add your Railway URL
3. Attach EA to USDJPY chart
4. Set ServerURL to your Railway URL

## Supabase Setup
Run supabase_setup.sql in your Supabase SQL editor.
