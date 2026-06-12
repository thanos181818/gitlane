# APK Build and Install Guide for GitLane (Expo React Native)

## Project context

- App name: GitLane Offline Git Client  
- Framework: Expo SDK 54, React Native 0.81  
- Android package: `app.rork.gitlane_offline_git_client`  
- The native Android folder already exists at `Frontend/android/`, so you do NOT need to run `expo prebuild` again.  

---

## Part 1 - Prerequisites (do this once, before anything else)

### 1.1 Check that Java is installed

Open a new PowerShell window and run:

```
java -version
```

You need Java 17 or Java 21. If you see an error or a version older than 17, download and install **Eclipse Temurin JDK 17** from https://adoptium.net and restart the terminal.

### 1.2 Check that Android SDK is installed

Android Studio installs the SDK automatically. If you have Android Studio, the SDK is likely at:

```
C:\Users\sm091\AppData\Local\Android\Sdk
```

Verify by running:

```
dir "C:\Users\sm091\AppData\Local\Android\Sdk\platform-tools\adb.exe"
```

If the file exists, your SDK is fine. If not, open Android Studio, go to **Settings > Languages and Frameworks > Android SDK**, and install the SDK.

### 1.3 Set ANDROID_HOME environment variable (if not already set)

Run this in PowerShell to check:

```
echo $env:ANDROID_HOME
```

If it prints nothing, set it temporarily for this session:

```
$env:ANDROID_HOME = "C:\Users\sm091\AppData\Local\Android\Sdk"
$env:PATH = "$env:ANDROID_HOME\platform-tools;" + $env:PATH
```

To make it permanent, open **System Properties > Environment Variables** and add:
- Variable name: `ANDROID_HOME`
- Variable value: `C:\Users\sm091\AppData\Local\Android\Sdk`

Then add `%ANDROID_HOME%\platform-tools` to the PATH variable.

---

## Part 2 - Set up your phone for USB debugging

Do all of these steps on your Android phone, not on your PC.

**Step 1.** Open **Settings** on your phone.

**Step 2.** Go to **About Phone** (sometimes inside "General Management").

**Step 3.** Find **Build Number**. Tap it exactly 7 times in a row. You will see a toast message saying "You are now a developer".

**Step 4.** Go back to **Settings**. You will now see a new option called **Developer Options** (sometimes inside "Additional Settings" or "System").

**Step 5.** Open **Developer Options** and toggle on **USB Debugging**.

**Step 6.** While still in Developer Options, also enable **Install via USB** if you see that option.

---

## Part 3 - Connect phone to PC and verify

**Step 1.** Plug your phone into your PC using a USB cable. Use the original cable or a data-capable cable (not a charge-only cable).

**Step 2.** On your phone, a popup will appear asking what type of USB connection you want. Select **File Transfer** or **MTP**. Do not select "Charge only".

**Step 3.** Another popup may appear on your phone: "Allow USB debugging from this computer?" - tap **Allow** and check "Always allow from this computer".

**Step 4.** In PowerShell, run:

```
adb devices
```

You should see output like this:

```
List of devices attached
XXXXXXXXX       device
```

Where XXXXXXXXX is your device serial number. If it says "unauthorized", unlock your phone and check for a new popup asking to allow USB debugging.

If `adb` is not recognized, make sure you completed Part 1.3 above.

---

## Part 4 - Build the debug APK from the terminal

This is the terminal-only approach. No Android Studio GUI needed for the build.

**Step 1.** Navigate to the Frontend folder of your project:

```
cd "C:\Users\sm091\Downloads\ONGOING-PROJECTS\SPIT-hack-gitlane\spit-hack\Mavericks\Frontend"
```

**Step 2.** Make sure all npm packages are installed:

```
npm install
```

**Step 3.** Navigate into the Android folder:

```
cd android
```

**Step 4.** Run the Gradle command to build a debug APK:

```
.\gradlew.bat assembleDebug
```

This will take 3-10 minutes the first time because Gradle downloads dependencies. Subsequent builds are faster.

When it finishes you will see:

```
BUILD SUCCESSFUL in Xm Xs
```

**Step 5.** The APK file is now located at:

```
C:\Users\sm091\Downloads\ONGOING-PROJECTS\SPIT-hack-gitlane\spit-hack\Mavericks\Frontend\android\app\build\outputs\apk\debug\app-debug.apk
```

---

## Part 5 - Install the APK on your phone via terminal

Make sure your phone is still connected and `adb devices` shows your device.

Run:

```
adb install "C:\Users\sm091\Downloads\ONGOING-PROJECTS\SPIT-hack-gitlane\spit-hack\Mavericks\Frontend\android\app\build\outputs\apk\debug\app-debug.apk"
```

You will see:

```
Performing Streamed Install
Success
```

The app will now appear in your phone's app drawer as "GitLane: Offline Git Client".

---

## Part 6 - Alternative: Do the build from Android Studio (GUI approach)

If the terminal build fails for any reason, use this approach instead.

**Step 1.** Open Android Studio.

**Step 2.** Click **Open** and navigate to:

```
C:\Users\sm091\Downloads\ONGOING-PROJECTS\SPIT-hack-gitlane\spit-hack\Mavericks\Frontend\android
```

Select this `android` folder and open it. Do NOT open the `Frontend` folder itself, open specifically the `android` subfolder.

**Step 3.** Wait for Gradle sync to finish. You will see "Gradle sync finished" in the bottom status bar. This can take a few minutes on first open.

**Step 4.** In the top toolbar, find the device dropdown (it shows "No Devices" or a phone name). Make sure your connected phone appears there.

**Step 5.** To run directly on your phone, click the green **Run** button (triangle icon) in the top toolbar. This builds the debug APK and installs it in one step.

**Step 6.** To generate just the APK file without running, go to:
**Build menu > Build Bundle(s) / APK(s) > Build APK(s)**

The APK will be saved to the same path as in Part 4 Step 5.

---

## Part 7 - If you get a Gradle build error

**Error: SDK location not found**

Open the file `Frontend/android/local.properties` and make sure it contains:

```
sdk.dir=C\:\\Users\\sm091\\AppData\\Local\\Android\\Sdk
```

Note the escaped backslashes. If this file is missing or wrong, Android Studio will regenerate it correctly when you open the project.

**Error: JAVA_HOME not set or wrong Java version**

In Android Studio, go to **File > Settings > Build, Execution, Deployment > Build Tools > Gradle** and set "Gradle JDK" to JDK 17 or JDK 21.

**Error: Execution failed for task ':app:processDebugManifest'**

This usually means a dependency is missing. Go back to the `Frontend` folder (not android) and run `npm install` again, then rebuild.

**Error: Could not resolve com.facebook.react:react-android**

Run this from the `Frontend` folder first:

```
npx expo install --check
```

Then go into `android` and run `.\gradlew.bat assembleDebug` again.

---

## Quick summary of the full flow

```
1. Phone: Enable Developer Options, enable USB Debugging
2. Phone: Connect via USB, select File Transfer, allow debugging popup
3. PC Terminal: adb devices  (verify phone is listed)
4. PC Terminal: cd into Frontend/android
5. PC Terminal: .\gradlew.bat assembleDebug
6. PC Terminal: adb install path\to\app-debug.apk
7. Phone: Open the app from your app drawer
```

---

## Notes

- The debug APK is larger than a release APK and runs slightly slower. For a hackathon demo this is perfectly fine.
- If you want a release APK later (for Play Store), you need to generate a signing keystore, which is a separate process.
- Every time you change JavaScript/TypeScript code and rebuild, `.\gradlew.bat assembleDebug` will pick up those changes because the JS bundle is compiled into the APK.
