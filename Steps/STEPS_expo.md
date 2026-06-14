# GitLane APK Build Guide

Complete instructions to build a production APK for Android using Expo Application Services (EAS).

---

## Prerequisites
- ✅ Node.js (v18 or later)
- ✅ Expo account (free) - [Sign up here](https://expo.dev/signup)
- ✅ Git installed

---

## Step 1: Install EAS CLI
Run this command in your terminal:

```bash
npm install -g @expo/eas-cli
```

Verify installation:
```bash
eas --version
```

---

## Step 2: Log In to Expo
```bash
eas login
```
- Follow the prompts to log in with your Expo account credentials

---

## Step 3: Configure EAS Build
First, make sure you're in the Frontend directory:
```bash
cd Mavericks/Frontend
```

Run the configuration command:
```bash
eas build:configure
```

This will create an `eas.json` file in your project.

---

## Step 4: Customize eas.json (Optional but Recommended)
Open `eas.json` and ensure it has a preview profile for APK builds:

```json
{
  "cli": {
    "version": ">= 10.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {}
  },
  "submit": {
    "production": {}
  }
}
```

---

## Step 5: Build the APK
Run this command to start the build:

```bash
eas build --platform android --profile preview
```

### What happens next:
1. EAS will upload your project to Expo's servers
2. The build will start (takes 5-15 minutes)
3. You'll get a download link once complete

---

## Step 6: Install the APK on Your Phone
Once you have the APK file:

### Option A: Transfer via USB
1. Connect your phone to your computer via USB
2. Enable "USB Debugging" in Developer Options
3. Copy the APK file to your phone
4. Open the APK file on your phone to install

### Option B: Download Directly
1. Open the build link on your phone
2. Download the APK file
3. Open and install it

### Note:
You may need to enable "Install from Unknown Sources" in your phone's settings.

---

## Alternative: Local Build (Requires Android Studio)
If you want to build locally instead of using EAS:

```bash
# Generate native Android project
npx expo prebuild

# Then open android folder in Android Studio and build
```

---

## Troubleshooting
- **Build fails**: Check the build logs for errors
- **Dependencies issues**: Run `npm install` again
- **EAS login issues**: Try `eas logout` then `eas login` again

---

## Quick Reference
```bash
# One-time setup
npm install -g @expo/eas-cli
eas login
eas build:configure

# Build APK
eas build --platform android --profile preview
```
