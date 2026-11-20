# Mobile app

Besides the [installable dashboard](./integrations#the-dashboard-on-a-phone) (PWA), Datick has an **Android and iOS app**. On first launch it asks for your instance's address (`https://support.example.com`), remembers it and opens its dashboard; **Change instance** picks another one.

## Download

- **Android**: every [release](https://github.com/LuquyPest/datick/releases) holds `datick-android.apk`, built by the CI. Open it on the phone (allow installs from that source). The repository can sign it with its own key (secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), otherwise it is a debug build.
- **iOS**: the project builds on a Mac with Xcode (`cd mobile && npm install && npm run ios`, then open `ios/App/App.xcworkspace`).
- Publishing on the Play Store and the App Store needs a developer account: it is left to whoever publishes the app.

## Notifications

The app gets the person's notifications (assignment, messages of followed tickets, reminders…) through **Firebase Cloud Messaging**:

1. Create a Firebase project, add an Android app (`xyz.datick.app`) and/or iOS app to it; keep `google-services.json` / `GoogleService-Info.plist` to build the app (repository secret `GOOGLE_SERVICES_JSON` for the CI's APK; on iOS, an APNs key in Firebase).
2. In **Instance → Health → Mobile app**, paste the project's **service account** (Project settings → Service accounts → Generate a private key). The private key is encrypted and never sent back.
3. On opening, the app asks for permission, gets its token and attaches it to the signed-in account (`/mobile-link` page). **Profile → What notifies me** lists the devices and lets you remove one.

A notification only goes out if the person sees the ticket; a device Firebase no longer knows (app uninstalled) is forgotten. Tapping the notification opens the ticket.
