# BJJ Tracker

A phone-friendly BJJ training tracker (installable PWA). This repo holds **only the app code**.
Live app: https://braydendueck.github.io/bjj-tracker/

- Training data (`data.json`: sessions, game-plan goals, move statuses, checklist ticks, focus start date) and the gym
  curriculum (`curriculum.json`) live in the separate **private** repo `braydendueck/bjj-tracker-data`.
- The app reads and writes that repo straight from your phone through the GitHub API, using a token you paste once.
  The token is kept only in that browser's local storage. Use **Settings ⚙ → Sign out / forget token** to remove it.
- The last loaded copy is kept on the device, so the app works offline. Changes made offline save when you're back online.
- If something else saves at the same time (for example the coach CLI), the app reloads, re-applies your change and saves again, so neither change is lost.

## Create the access token (one time, about 2 minutes)

1. Open this link (signed in to GitHub as braydendueck):
   https://github.com/settings/personal-access-tokens/new?name=BJJ+Tracker+phone&target_name=braydendueck&expires_in=90&contents=write
   It's a **fine-grained** token. The link fills in the name, a 90-day expiry, and the Contents permission.
2. **Repository access:** choose **Only select repositories**, then pick **bjj-tracker-data** only.
3. **Permissions → Repository permissions → Contents:** **Read and write**. Leave everything else off
   (GitHub adds "Metadata: Read-only" automatically. That's normal).
4. **Expiration:** keep an expiry date. 90 days is fine. When it expires, the app asks for a new one.
5. Tap **Generate token**, copy it (it starts with `github_pat_`), open the app and paste it in.

**Optional, one token for both apps:** instead of a new token you can edit your Order Tracker token at
https://github.com/settings/personal-access-tokens, add `bjj-tracker-data` under Repository access, and paste that same token
(the app offers a "Try my Order Tracker token" button). A separate token per app is the default, because each one then
only touches its own data.

On iPhone: open the app in Safari → Share → **Add to Home Screen**.
