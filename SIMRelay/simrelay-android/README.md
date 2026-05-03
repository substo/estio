# Android SIM Relay Companion App

This directory contains the source code for the native Android SIM Relay app.

## How to Build and Run

1. Open **Android Studio**.
2. Select **File > Open** and navigate to `SIMRelay/simrelay-android`.
3. Allow Android Studio to sync the project. It will automatically download Gradle and the required Android SDK packages if you don't already have them.
4. Connect a physical Android phone via USB and enable **USB Debugging** in Developer Options. (Note: Emulators cannot send physical SMS messages).
5. Click the green **Run (Play)** button in Android Studio to build the APK and install it on your device.

## Production Configuration

Before building the final APK for your team, be sure to update the `BASE_URL` in `app/src/main/java/com/estio/simrelay/api/ApiClient.kt` to point to your live CRM production URL (e.g., `https://app.estio.co`).

## Features
- **Pairing**: Securely pairs the device to the CRM.
- **Foreground Service**: Ensures the app is not killed by the Android OS while it polls for outbound SMS jobs.
- **Auto-Start**: Restarts the service automatically when the phone reboots (via `BootReceiver`).
- **Inbound Forwarding**: Listens to incoming SMS texts and posts them instantly to the CRM webhook.
