# Application mobile

En plus du [dashboard installable](./integrations#le-dashboard-sur-telephone) (PWA), Datick a une **application Android et iOS**. Au premier lancement, elle demande l'adresse de ton instance (`https://support.exemple.fr`), la retient et ouvre son dashboard ; **Changer d'instance** en choisit une autre.

## Télécharger

- **Android** : chaque [release](https://github.com/LuquyPest/datick/releases) contient `datick-android.apk`, construit par la CI. Ouvre-le sur le téléphone (autoriser l'installation depuis cette source). Le dépôt peut le signer avec sa propre clé (secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), sinon c'est une version de débogage.
- **iOS** : le projet se construit sur un Mac avec Xcode (`cd mobile && npm install && npm run ios`, puis ouvrir `ios/App/App.xcworkspace`).
- La publication sur le Play Store et l'App Store demande un compte développeur : elle reste à faire par qui publie l'application.

## Les notifications

L'application reçoit les notifications de la personne (attribution, messages des tickets suivis, rappels…) par **Firebase Cloud Messaging** :

1. Crée un projet Firebase, ajoute-y une application Android (`xyz.datick.app`) et/ou iOS ; garde `google-services.json` / `GoogleService-Info.plist` pour construire l'application (secret `GOOGLE_SERVICES_JSON` du dépôt pour l'APK de la CI ; sur iOS, une clé APNs dans Firebase).
2. Dans **Instance → Santé → Application mobile**, colle le **compte de service** du projet (Paramètres du projet → Comptes de service → Générer une clé privée). La clé privée est chiffrée et jamais renvoyée.
3. À l'ouverture, l'application demande la permission, obtient son jeton et le rattache au compte connecté (page `/mobile-link`). **Profil → Ce qui me prévient** liste les appareils et permet d'en retirer un.

Une notification ne part que si la personne voit le ticket ; un appareil que Firebase ne connaît plus (application désinstallée) est oublié. Toucher la notification ouvre le ticket.
