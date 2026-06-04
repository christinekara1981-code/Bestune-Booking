# Firebase Setup For Shared Bestune Booking Data

GitHub Pages can host the app, but it cannot store one shared master file by itself. Firebase Realtime Database gives the HTML app a shared live database.

## Steps

1. Go to https://console.firebase.google.com/.
2. Create a new project.
3. Add a Web app.
4. Create a Realtime Database.
5. Start in test mode while testing, then tighten rules later.
6. Copy the Firebase config.
7. Open `app.js`.
8. Replace the empty `firebaseConfig` values:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  appId: "YOUR_APP_ID"
};
```

9. Upload the updated files to GitHub.
10. Open the GitHub Pages link.

The app status should change from `Local mode` to `Shared live data`.
