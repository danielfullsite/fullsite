#!/bin/bash
# Rappi sync — cron local (Mac)
# Instalar: crontab -e → 0 7 * * * /Users/danielrg/fullsite/.github/scripts/rappi_cron_local.sh
cd /Users/danielrg/fullsite
source dashboard-app/.env.local 2>/dev/null
export RAPPI_USER="ventas@cafeamalay.com"
export RAPPI_PASSWORD="Amalay154!"
export SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL"
export SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY"
python3 .github/scripts/rappi_sync.py --days 14 >> /tmp/rappi-sync.log 2>&1
