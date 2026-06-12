# GitLane — Final Steps

---

## Phase 1 — Run Locally (Expo Go)

Run all commands from the `Frontend/` directory.

```powershell
cd "C:\Users\sm091\Downloads\ONGOING-PROJECTS\SPIT-hack-gitlane\spit-hack\Mavericks\Frontend"
```

**Step 1 — Set the WebSocket key for this terminal session (required for P2P relay):**
```powershell
$env:EXPO_PUBLIC_PIESOCKET_KEY = "HIz4ja8E3q2AiQWmXyKfAS1SQ3jfc06gbkE58Q38"
```
> This is already saved in `Frontend/.env`, so Expo picks it up automatically.
> The manual `$env:` command is only needed if you're running a bare Node/Gradle command in the same session.

**Step 2 — Install dependencies (only needed once or after pulling new changes):**
```powershell
npm install
```

**Step 3 — Start the Expo dev server:**
```powershell
npx expo start
```

**Step 4 — Open on device:**
- Scan the QR code with the **Expo Go** app on your phone.
- Both your phone and PC must be on the **same Wi-Fi network**.
- If the QR scan fails, press `t` in the terminal to switch to **tunnel mode**.

---

## Phase 2 — Build the APK

Run all commands from the `Frontend/` directory unless noted.

```powershell
cd "C:\Users\sm091\Downloads\ONGOING-PROJECTS\SPIT-hack-gitlane\spit-hack\Mavericks\Frontend"
```

**Step 1 — Install dependencies:**
```powershell
npm install
```

**Step 2 — Navigate into the Android folder:**
```powershell
cd android
```

**Step 3 — Build the debug APK:**
```powershell
.\gradlew.bat assembleDebug
```
> First build takes 3–10 minutes. Look for `BUILD SUCCESSFUL` at the end.

**Step 4 — Connect your phone via USB and verify it's detected:**
```powershell
adb devices
```
> You should see your device serial listed as `device` (not `unauthorized`).

**Step 5 — Install the APK on your phone:**
```powershell
adb install "C:\Users\sm091\Downloads\ONGOING-PROJECTS\SPIT-hack-gitlane\spit-hack\Mavericks\Frontend\android\app\build\outputs\apk\debug\app-debug.apk"
```
> You should see `Performing Streamed Install` then `Success`.

---

## If the build breaks

**SDK not found:**
Check `Frontend/android/local.properties` contains:
```
sdk.dir=C\:\\Users\\sm091\\AppData\\Local\\Android\\Sdk
```

**ANDROID_HOME not set:**
```powershell
$env:ANDROID_HOME = "C:\Users\sm091\AppData\Local\Android\Sdk"
$env:PATH = "$env:ANDROID_HOME\platform-tools;" + $env:PATH
```

**Missing packages:**
```powershell
npx expo install --check
```
Then rebuild from Step 3.


# You're already in the right directory - no cd needed!

# Install EAS CLI (correct package name)
npm install -g eas-cli

# Login to Expo
eas login

# Configure EAS
eas build:configure

# Build APK!
eas build --platform android --profile preview