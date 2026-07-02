// lib/integrations/bootstrap.ts
//
// Side-effect-only entry point that loads every shipping adapter. Each
// adapter's `index.ts` calls `registerAdapter(...)` at module load, so
// importing this file populates the registry.
//
// Importing `@/lib/integrations/registry` does NOT load adapters — it only
// gives you the API. To get a fully-populated registry, import this file.

import '@/lib/integrations/adsense'
import '@/lib/integrations/admob'
import '@/lib/integrations/revenuecat'
import '@/lib/integrations/app_store_connect'
import '@/lib/integrations/play_console'
import '@/lib/integrations/google_ads'
import '@/lib/integrations/ga4'
import '@/lib/integrations/firebase_analytics'

export {}
