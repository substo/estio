# Android SIM Relay Companion App

This directory contains the native Android companion app used by Estio to send and receive SMS through a paired Android phone and SIM card.

## Development Install

Use Android Studio installs only while developing or debugging the app.

1. Open **Android Studio**.
2. Select **File > Open** and choose `SIMRelay/simrelay-android`.
3. Let Gradle sync and download any required Android SDK packages.
4. Connect a physical Android phone with USB debugging enabled.
5. Click **Run** to install the debug build.

Emulators cannot send or receive physical SIM SMS messages, so final verification must happen on a real phone with an active SIM.

## Production Update Strategy

The recommended production path is:

1. Build a signed Android App Bundle (`.aab`).
2. Publish it as a private app through **Managed Google Play**.
3. Enroll the relay phone with Android Enterprise through an MDM/EMM provider.
4. Mark the SIM Relay app as required/auto-installed.
5. Configure high-priority app updates.

After this setup, new app releases are published through Managed Google Play and the phone updates automatically. Android Studio is no longer part of the production update flow.

Firebase App Distribution is useful for tester builds, but it is not the best final production path for a relay phone that should update automatically without manual installs.

## Versioning

Release versions are controlled in `gradle.properties`:

```properties
SIMRELAY_VERSION_CODE=1
SIMRELAY_VERSION_NAME=1.0
```

For every Managed Google Play release:

1. Increase `SIMRELAY_VERSION_CODE`.
2. Set `SIMRELAY_VERSION_NAME` to the visible version label.
3. Build and upload a new release artifact.

Google Play requires every uploaded release to have a higher `versionCode` than the previous release.

## Release Signing

Release signing is configured from environment variables or an untracked `release.properties` file. Do not commit keystores, passwords, or `release.properties`.

The Gradle build reads these values:

```properties
SIMRELAY_UPLOAD_STORE_FILE=keystores/simrelay-upload.jks
SIMRELAY_UPLOAD_STORE_PASSWORD=change-me
SIMRELAY_UPLOAD_KEY_ALIAS=simrelay-upload
SIMRELAY_UPLOAD_KEY_PASSWORD=change-me
```

The same names can also be provided as environment variables.

### Create an Upload Key

From `SIMRelay/simrelay-android`:

```bash
mkdir -p keystores
keytool -genkeypair \
  -v \
  -keystore keystores/simrelay-upload.jks \
  -storetype JKS \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias simrelay-upload
```

Store the keystore and passwords in your password manager. Losing the upload key can block future releases unless Play App Signing key reset is available for the app.

Create `release.properties` locally:

```properties
SIMRELAY_UPLOAD_STORE_FILE=keystores/simrelay-upload.jks
SIMRELAY_UPLOAD_STORE_PASSWORD=your-store-password
SIMRELAY_UPLOAD_KEY_ALIAS=simrelay-upload
SIMRELAY_UPLOAD_KEY_PASSWORD=your-key-password
```

Check the build sees the release config:

```bash
./gradlew :app:printReleaseConfig
```

If this prints `Release signing: not configured`, the release tasks can still be used for local validation, but the artifact is not ready for Managed Google Play upload.

## Build Commands

Debug build:

```bash
./gradlew assembleDebug
```

Signed release APK for direct testing:

```bash
./gradlew assembleRelease
```

Signed release bundle for Managed Google Play:

```bash
./gradlew bundleRelease
```

The Managed Google Play artifact is:

```text
app/build/outputs/bundle/release/app-release.aab
```

## Managed Google Play Tutorial

There are three systems involved:

- **Google Play Console**: where the private Android app release is uploaded.
- **Managed Google Play / Android Enterprise**: the private app catalog for your organization.
- **MDM/EMM**: the device-management tool that installs and updates the app on the phone.

Examples of MDM/EMM tools are Google Workspace endpoint management, Microsoft Intune, Miradore, Esper, Scalefusion, Hexnode, and ManageEngine. The screens differ by provider, but the workflow is the same: bind Android Enterprise, add the private app, assign it to the relay phone, and force automatic updates.

### 1. Create the Release Artifact

1. Deploy the Estio backend first if the Android release depends on API changes.
2. Increase `SIMRELAY_VERSION_CODE` in `gradle.properties`.
3. Update `SIMRELAY_VERSION_NAME` if needed.
4. Confirm release signing is configured:

   ```bash
   ./gradlew :app:printReleaseConfig
   ```

5. Build the release bundle:

   ```bash
   ./gradlew bundleRelease
   ```

6. The file to upload is:

   ```text
   SIMRelay/simrelay-android/app/build/outputs/bundle/release/app-release.aab
   ```

7. Keep the generated `.aab`; do not commit it.

### 2. Create a Google Play Developer Account

Skip this section only if you already have a Google Play Console developer account.

1. Go to `https://play.google.com/console`.
2. Sign in with the Google account that should own the app publishing account.
3. Complete the developer registration flow.
4. Accept the Google Play Developer distribution agreement.
5. Pay the registration fee.
6. Enter the developer account details.
7. Wait for Google to finish processing the account if it is not approved immediately.

Use a company-owned Google account, not a personal throwaway account, because this account controls future app releases.

### 3. Create the Private App in Play Console

1. Go to `https://play.google.com/console`.
2. Open **All apps**.
3. Click **Create app**.
4. Set the app name, for example `Estio SIM Relay`.
5. Choose the default language.
6. Choose **App** as the app type.
7. Choose whether it is free/paid. For private internal use, choose free unless you have a reason otherwise.
8. Confirm the declarations shown by Play Console and create the app.
9. In the left navigation, go to **Test and release > Setup > Advanced settings**.
10. Open the **Managed Google Play** tab.
11. Under **Organizations**, click **Add organization**.
12. Add your Android Enterprise organization ID and a recognizable description.
13. Click **Save changes**.

If you do not know the Organization ID yet, create/bind Android Enterprise in your MDM first, then come back to this step. In many MDMs you can find it from the Managed Google Play iframe under **Admin settings** or **Organization details**.

### 4. Upload the Private Release

1. In Play Console, open the SIM Relay app.
2. Go to **Test and release > Production**.
3. Click **Create new release**.
4. Upload:

   ```text
   app/build/outputs/bundle/release/app-release.aab
   ```

5. Follow the Play App Signing prompts if this is the first release.
6. Enter release notes, for example `Initial managed release`.
7. Save the release.
8. Review Play Console warnings or required declarations.
9. Click **Review release**.
10. Click **Start rollout to Production**.

Because the app is restricted to your organization, this production release is private. It is not intended to appear publicly in Google Play.

For this app, avoid public Play Store distribution unless you have handled Google Play SMS permission policy requirements. The app declares `SEND_SMS`, `RECEIVE_SMS`, and `READ_SMS`, which Google restricts for public distribution unless the app qualifies, for example as a default SMS handler or under an approved exception.

### 5. Set Up Android Enterprise in Your MDM

Do this in your MDM/EMM admin console, not in Android Studio.

1. Create or open your MDM account.
2. Find the Android setup area. Common menu names are:
   - **Android Enterprise**
   - **Managed Google Play**
   - **Android management**
   - **Device management > Android**
3. Click the option to **Bind**, **Connect**, or **Set up Android Enterprise**.
4. Sign in with the Google admin account for the organization.
5. Enter the organization name when prompted.
6. Accept the Android Enterprise / Managed Google Play setup prompts.
7. Finish the binding and return to the MDM console.

After this, the MDM can see Managed Google Play apps and install approved/private apps on enrolled devices.

### 6. Add SIM Relay to the MDM App Catalog

In your MDM:

1. Open the app management area. Common menu names are:
   - **Apps**
   - **Applications**
   - **Managed Google Play**
   - **Android apps**
2. Choose **Add app** or **Approve app**.
3. Search Managed Google Play for:

   ```text
   pname:com.estio.simrelay
   ```

4. Select `Estio SIM Relay`.
5. Approve it for your organization.
6. Add it to an app group or policy assigned to the relay phone.
7. Set install behavior to **Required**, **Force install**, or **Auto install**.
8. Set update behavior to **Automatic** or **High priority** if your MDM exposes that option.

If the app does not appear immediately after publishing, wait a few minutes and search again by package name.

### 7. Enroll the Relay Phone

The best mode for this use case is a company-owned or dedicated device, because the phone is infrastructure for SMS relay.

1. Factory reset the relay phone if your MDM requires fully managed enrollment.
2. In the MDM, create or open the Android enrollment profile.
3. Choose a profile type like **Fully managed device**, **Corporate-owned device**, or **Dedicated device**.
4. Follow the MDM's enrollment method. Common methods are:
   - QR code enrollment during Android first setup.
   - Zero-touch enrollment.
   - Enrollment token.
   - MDM agent app enrollment.
5. Complete Android setup on the phone.
6. Confirm the phone appears as managed/enrolled in the MDM console.
7. Assign the policy that contains SIM Relay.
8. Wait for the app to install from Managed Google Play.

### 8. Configure the Relay Phone Policy

In the MDM device policy, configure:

1. SIM Relay app install mode: **required / force install / auto install**.
2. App update mode: **automatic / high priority**.
3. Runtime permissions:
   - SMS: allow if your MDM supports granting it.
   - Notifications: allow.
   - Camera: allow if QR pairing is used.
4. Battery policy:
   - Allow background activity for SIM Relay.
   - Disable battery optimization for SIM Relay if your MDM supports it.
5. Device restrictions:
   - Prevent users from uninstalling SIM Relay.
   - Keep Google Play updates enabled.
   - Keep network connectivity enabled.

If the MDM cannot auto-grant SMS permissions, open the app once on the phone and grant them manually.

The exact MDM screens differ by provider, but the target policy is always the same: the SIM Relay app is required, auto-installed, allowed to run in the background, and updated automatically.

### 9. First Device Setup

1. Let the MDM install the app on the phone.
2. Open the app once.
3. Grant SMS, notification, and camera permissions.
4. Pair the device from Estio.
5. Start the relay service.
6. Send one outbound Android SMS from Estio.
7. Send one inbound SMS to the phone SIM and confirm it appears in the Estio conversation.

### 10. Future Releases

For every new Android release:

1. Deploy backend changes first if needed.
2. Increase `SIMRELAY_VERSION_CODE`.
3. Build `bundleRelease`.
4. Upload the `.aab` to the private Managed Google Play app.
5. Publish the release to the organization.
6. Confirm the relay phone receives the update.
7. Verify the phone is still paired and the relay service is running.
8. Test outbound and inbound SMS.

If the package name remains `com.estio.simrelay` and app data is not cleared by policy, the update installs over the existing app and preserves pairing data.

### Troubleshooting

- **Private app does not show in MDM**: Search by `pname:com.estio.simrelay`, wait a few minutes after publishing, and confirm the Play Console app is restricted to the correct organization ID.
- **Phone does not update**: Confirm the app policy is assigned to the phone, Managed Google Play is enabled, network is available, and update mode is automatic/high priority.
- **App installs but SMS does not work**: Open Android settings and confirm SMS permissions are allowed. Some MDMs cannot silently grant restricted permissions.
- **Update removed pairing**: Check the MDM is not clearing app data during updates. Normal app updates preserve pairing because the package name stays `com.estio.simrelay`.
- **Play Console rejects the app**: Keep the release private to your organization and review Google's SMS permission declarations carefully.

## Features

- **Pairing**: Securely pairs the device to Estio.
- **Foreground Service**: Keeps the relay active while polling outbound SMS jobs.
- **Auto-Start**: Restarts the service after reboot through `BootReceiver`.
- **Inbound Forwarding**: Receives incoming SMS and forwards them into Estio conversations.
