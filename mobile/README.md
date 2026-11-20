# Application mobile Datick

Une application Android et iOS (Capacitor) qui ouvre l'instance Datick choisie au premier lancement, avec ses notifications. Le guide complet : [Application mobile](https://docs.bot.daryu.xyz/guide/application-mobile).

```bash
cd mobile
npm install
npm run android   # projet Android (Android Studio, ou ./gradlew assembleDebug dans android/)
npm run ios       # projet iOS, sur un Mac avec Xcode et CocoaPods
```

Les notifications passent par Firebase Cloud Messaging : `google-services.json` (Android) et `GoogleService-Info.plist` (iOS) du projet Firebase, et son compte de service dans Instance → Santé → Application mobile.
