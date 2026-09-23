ECORP CHECK-IN - SUPABASE TEST

1. Netlify serves this frontend and exposes only the Supabase public configuration.
2. Required Netlify environment variables:
   SUPABASE_URL = Supabase Project URL
   SUPABASE_PUBLISHABLE_KEY = Supabase Publishable key
3. Authentication: Google OAuth through Supabase Auth.
4. Employee access: email must exist in public.employees and active=true.
5. Check-in photos upload directly from the browser to Supabase Storage bucket:
   checkin-photos
6. Check-in records are inserted directly into public.checkins.

The existing Google Sheet TEST and Apps Script TEST are kept as the old-system
reference during migration. Google Sheet synchronization will be added separately
after the direct Supabase check-in flow is verified.

The UI and existing check-in features are intentionally preserved..
