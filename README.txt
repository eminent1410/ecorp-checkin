ECORP CHECK-IN - NETLIFY

1. Deploy the whole folder to Netlify.
2. Netlify Environment Variable:
   GOOGLE_CLIENT_ID = your Google OAuth Client ID
3. Google OAuth Authorized JavaScript origin:
   https://ecorp-checkin.netlify.app
4. The Netlify Function proxies authenticated requests to the existing Google Apps Script Web App.

IMPORTANT:
- Code_checkin.js is NOT part of this Netlify package.
- Code_checkin.js remains in the separately deployed Google Apps Script Web App.
- The frontend sends `emotionReason` only when the selected emotion is "Chưa tốt lắm".
- The existing Apps Script already validates and stores `emotionReason` in the CHECKIN sheet's "Lý do" column.

Frontend camera and GPS run directly in the browser over HTTPS.
Netlify Function proxies authenticated requests to Apps Script to avoid browser CORS issues. Enable branch deploy for supabase-test
