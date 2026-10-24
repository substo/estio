# Estio Relay for iPhone: build, connect, distribute, and update

Last verified against Apple documentation: 18 August 2026.

## What Apple permits

The Android app is an unattended gateway. It polls Estio, sends SMS through `SmsManager`, receives incoming SMS through a broadcast receiver, mirrors sent messages, and keeps the STO WebSocket/network relay alive in foreground services.

An App Store iPhone app cannot reproduce that behavior:

- `MFMessageComposeViewController` can prefill a recipient and body, but the user must approve or cancel each message. The Messages app performs the send. Apple explicitly says the composer only presents a message for the person's approval: <https://developer.apple.com/documentation/messageui/mfmessagecomposeviewcontroller>
- iOS does not provide a general API for reading the user's SMS inbox. The IdentityLookup extension is only for classifying SMS/MMS from unknown senders; it is not an inbox relay and does not cover contacts or iMessage: <https://developer.apple.com/documentation/identitylookup/sms-and-mms-message-filtering>
- Background notifications are low priority, may be throttled, are not guaranteed, and are intended to refresh content rather than sustain a five-second polling loop: <https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app>
- App Review guideline 2.5.4 restricts background services to their intended purposes. VPN apps have additional organization, disclosure, privacy, and `NEVPNManager` requirements under guideline 5.4: <https://developer.apple.com/app-store/review/guidelines/>

Therefore the supported iPhone capability is **interactive SMS**: pair, load queued messages while the app is open, open Apple's composer, and let the user approve each send. It has no inbound-SMS or STO/WhatsApp-egress capability.

## Current repository implementation

The iOS project is at `SIMRelay/simrelay-ios/SIMRelay/SIMRelay/SIMRelay.xcodeproj`.

The implemented flow is:

1. In Estio, open **Connected Devices**, choose **Pair Device**, select **iPhone**, and generate a code.
2. In the iPhone app, use the production Estio URL and enter the code.
3. The app calls `POST /api/sms-relay/gateway/pair` with `platform: ios` and `capabilities: [interactive_sms]`.
4. Estio returns the device token once. The app stores it in the iOS Keychain.
5. The app loads jobs from `GET /api/sms-relay/gateway/jobs` while open.
6. Tapping **Send** opens Apple's Messages composer. The result is reported to `POST /api/sms-relay/gateway/job-result` as `sent`, `cancelled`, or `failed`.

The server refuses to grant an iPhone `sms_relay` or `whatsapp_egress`, even if a modified client requests those capabilities.

## One-time Apple setup

1. Install the full current Xcode from the Mac App Store. This machine currently has only Command Line Tools, so `xcodebuild` cannot build the app yet.
2. Enroll the company, not a contractor's personal account, in the Apple Developer Program. Organization enrollment needs a legal entity, D-U-N-S number, authority to bind the organization, work-domain email, public company website, and two-factor authentication. The current annual fee is USD 99: <https://developer.apple.com/help/account/membership/program-enrollment/>
3. In **Certificates, Identifiers & Profiles**, register an explicit App ID for `co.estio.simrelay` under the company's team.
4. In App Store Connect, create the app record with the same bundle ID, a unique SKU, primary language, and the final display name.
5. In Xcode, open the project, select the app target, open **Signing & Capabilities**, choose the company team, and keep automatic signing enabled. Change the hard-coded team if `5RYB6BGMY6` is not the production account.
6. Use a physical iPhone with an active SIM/eSIM for SMS testing. The simulator can test pairing and screens but cannot send cellular SMS.

Apple's enrollment requirements: <https://developer.apple.com/help/account/membership/program-enrollment/>. Apple's Xcode distribution overview: <https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases>.

## Build and device test

1. Connect the iPhone to the Mac, unlock it, trust the Mac, and enable Developer Mode if iOS asks.
2. Choose the physical iPhone as the Xcode run destination and press **Run**.
3. In Estio Connected Devices, create an iPhone pairing code.
4. Pair in the app and confirm the device card changes to **iPhone** with only interactive SMS capability.
5. Queue a test SMS in Estio, refresh the iPhone app, tap **Send**, approve it in Apple's composer, and verify Estio changes the message from pending to sent.
6. Test cancellation, airplane mode, an expired pairing code, an unpaired token, a phone without SMS service, and multipart/non-ASCII text.
7. Confirm that the app never claims it can receive messages or work unattended.

## Recommended release path

Use this progression:

1. **Development install** for the first physical device.
2. **TestFlight** for beta testers. It supports up to 100 internal and 10,000 external testers, but every build expires after 90 days. External beta testing may require review: <https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/>.
3. **Unlisted App Store distribution** for production if the app is only for Estio customers or partners. It is installed through a private direct App Store link, works on managed and unmanaged devices, receives ordinary App Store updates, and is not searchable. It still requires full App Review: <https://developer.apple.com/support/unlisted-app-distribution/>.

If access must be restricted to named client companies, use a **Custom App** through Apple Business Manager instead. The developer selects specific organization IDs; those organizations distribute the app through MDM or redemption codes: <https://developer.apple.com/support/volume-purchase-and-custom-apps/>.

## App Store submission checklist

Before the first submission:

- Finalize app name, subtitle, description, category, age rating, support URL, marketing URL if used, privacy-policy URL, screenshots for required iPhone sizes, and the app icon.
- Complete App Privacy answers from the actual data flow: device label, phone number entered in Estio, device identifier/token, message recipient/body fetched for sending, diagnostics, and account/location association. Do not guess these answers.
- Give App Review a working demo account/location, an active pairing code or repeatable pairing instructions, and a video if the reviewer cannot access the CRM setup.
- Explain prominently in Review Notes that every SMS is user-approved in Apple's standard composer and that the app does not read SMS or provide a VPN.
- Archive with **Any iOS Device (arm64)**, choose **Distribute App → App Store Connect → Upload**, and wait for processing. Apple supports uploads from Xcode, Transporter, or its API: <https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds>.
- Select the processed build, complete compliance questions, add it for review, and submit: <https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app>.
- Once approved, request unlisted distribution if that is the chosen production channel.

## Updating users over time

For App Store, unlisted, and Custom App distribution:

1. Increment `MARKETING_VERSION` for a customer release and always increment `CURRENT_PROJECT_VERSION` for each upload.
2. Build, test pairing and send/cancel again, archive, and upload to the same App Store Connect app record.
3. Create the new version, attach the new build and release notes, then submit it for review. Apple documents the version workflow here: <https://developer.apple.com/help/app-store-connect/update-your-app/create-a-new-version>.
4. After approval, release manually, automatically, or in phases. Users receive it through normal App Store update behavior.
5. Keep the server API backward compatible with at least the currently released version. Add a server-provided minimum-supported-version policy before making a breaking API change.

For TestFlight, upload a replacement before the current 90-day build expires. TestFlight is not a permanent production update channel.

## Why a manually downloadable IPA is not the default

Outside the EU, iOS does not support unrestricted website download of an IPA for ordinary customers.

- **Ad Hoc** requires registering each device UDID and is limited to 100 iPhones per membership year. It is intended for limited testing/internal use, and updates require rebuilding/reinstalling with a valid profile: <https://developer.apple.com/help/account/devices/devices-overview>.
- **Enterprise** distribution is only for proprietary apps used internally by employees. Apple says the organization generally needs 100 or more employees and must show that App Store, Custom Apps, Ad Hoc, and TestFlight do not fit: <https://developer.apple.com/programs/enterprise/>.
- **EU Web Distribution** is not a practical starting route. It is limited to eligible EU users and authorized developers, requires notarization and a registered website domain, and Apple's current terms require two continuous years in good standing plus an app with more than one million first annual installs in the EU: <https://developer.apple.com/support/dma-and-apps-in-the-eu>.

For this app, the best production answer is an **unlisted App Store app**. It provides the private-link experience the product wants without fragile provisioning, and Apple handles installation and updates.

## Next implementation slices

1. Install Xcode and complete a physical-device build/test of the current pairing slice.
2. Add QR scanning with AVFoundation so iPhone pairing matches Android.
3. Add normal visible APNs alerts for newly queued jobs. A notification can bring the user back to the approval screen, but it cannot silently send the SMS. APNs provider setup starts here: <https://developer.apple.com/documentation/usernotifications/setting-up-a-remote-notification-server>.
4. Add a lightweight foreground heartbeat and show **Approval required** rather than generic **online** for iPhone in Connected Devices.
5. Add iOS unit/UI tests, App Store screenshots, privacy policy text, review notes, and TestFlight automation.
