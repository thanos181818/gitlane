# GitLane: Offline Git Client - Setup & Run Guide

## Prerequisites
- Node.js (v18 or later)
- npm or bun (bun recommended)
- Git
- Expo Go app (for mobile testing) - [Download on Android](https://play.google.com/store/apps/details?id=host.exp.exponent) or [iOS](https://apps.apple.com/app/expo-go/id982107779)

---

## Step 1: Navigate to the Frontend Directory
```bash
cd Mavericks/Frontend
```

## Step 2: Install Dependencies
Choose one of the following options:

### Option A: Using bun (Recommended)
```bash
bun install
```

### Option B: Using npm
```bash
npm install
```

## Step 3: Start the Development Server
Choose one of the following options based on your needs:

### Option A: Default Start (Recommended - Mobile & Web)
```bash
bun run start
# or
npm start
```
- This will show a QR code in your terminal
- Scan with Expo Go on your mobile device
- Press `w` in terminal to open web version

### Option B: Web Only
```bash
bun run start-web
# or
npm run start-web
```
- Opens directly in your default browser

### Option C: Tunnel Mode (for remote connections)
```bash
bun run start-tunnel
# or
npm run start-tunnel
```
- Use this if your phone and computer are on different networks

### Option D: Android Emulator (Requires Android Studio)
```bash
bun run android
# or
npm run android
```

---

## Step 4: Explore the App
GitLane includes these main features:
- 📂 **Repos Tab**: Manage your Git repositories (create, clone, import)
- 📊 **Graph Tab**: Visualize commit history as an interactive graph
- 🔄 **Transfer Tab**: P2P repo transfer via QR code
- 👤 **Profile Tab**: GitHub profile and contribution calendar
- ⚙️ **Settings Tab**: Configure Git identity, notifications, etc.
- 💬 **Chatbot**: AI-powered Git assistant (stubbed for now)

---

## Step 5: Optional - Build for Production
### Install EAS CLI
```bash
npm install -g @expo/eas-cli
```

### Configure EAS
```bash
eas build:configure
```

### Build for Android
```bash
eas build --platform android --profile preview
```

### Build for iOS
```bash
eas build --platform ios --profile preview
```

---

## Troubleshooting
- **Dependencies issues**: Delete `node_modules` and `bun.lock` (or `package-lock.json`), then reinstall
- **Clear cache**: Run `bunx expo start --clear`
- **Network issues**: Try tunnel mode with `bun run start-tunnel`

---

## Project Structure Overview
```
Mavericks/Frontend/
├── app/              # App screens (Expo Router file-based routing)
├── components/       # Reusable React components
├── services/         # Business logic (Git, GitHub, P2P, storage, etc.)
├── contexts/         # React Context providers
├── constants/        # App constants (colors, theme)
├── assets/           # Images and static assets
└── __tests__/        # Jest tests
```
