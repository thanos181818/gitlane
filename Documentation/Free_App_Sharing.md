# GitLane Free App Sharing Options
Last Updated: 2026-06-12

---

## Option 1: Expo Go (Quickest, For Testing)
Best for sharing with friends/testers who have Expo Go installed.
- Pros: No need to build APK, instant sharing
- Cons: Requires Expo Go, not for production
- How:
  1. Run `cd Mavericks/Frontend && npm start`
  2. Share the QR code or URL

---

## Option 2: EAS Internal Distribution (Most Professional)
Best for controlled testing with a team.
- Pros: Native app, easy updates, Expo-hosted
- Cons: Testers need Expo Go or an Expo account
- How:
  1. Build a preview APK: `eas build --platform android --profile preview`
  2. Share the download link from your Expo dashboard

---

## Option 3: GitHub Releases (Good for Open Source)
Best if your code is on GitHub.
- Pros: Versioned releases, free hosting
- Cons: Users need to enable "Unknown Sources"
- How:
  1. Build your APK: `eas build --platform android --profile preview`
  2. Go to your GitHub repo → Releases → Draft a new release
  3. Upload the APK, add release notes, publish

---

## Option 4: Google Drive/Dropbox/OneDrive
Best for quick one-off shares with friends.
- Pros: Super easy, free
- Cons: Users need to enable "Unknown Sources"
- How:
  1. Build your APK
  2. Upload to your cloud storage
  3. Share the download link

---

## Option 5: F-Droid (For Open Source Apps)
Best for open source apps, trusted by privacy-focused users.
- Pros: Curated store, no "Unknown Sources" needed
- Cons: Strict requirements, takes time to get listed
- Learn more: https://f-droid.org/docs/

---

## Enabling "Unknown Sources" (For APKs Not From Play Store)
When users install your APK directly:
1. Go to Settings → Security
2. Enable "Unknown Sources" (or "Install unknown apps")
3. Open the APK and install

---

## Recommendation
- **For testing**: Use EAS Internal Distribution or Expo Go
- **For friends/family**: Use Google Drive/Dropbox
- **For open source**: Use GitHub Releases

---

Happy sharing! 🚀
