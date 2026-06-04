# Bestune Booking GitHub Pages Version

This folder is ready for GitHub Pages.

## How to publish

1. Create a GitHub repository.
2. Upload all files in this folder to the repository.
3. In GitHub, open Settings > Pages.
4. Set the source to the main branch and root folder.
5. Open the Pages link from GitHub on desktop or mobile.

## Important

This version is static, so it works on GitHub Pages without a server.

By default, changes are saved in each user's browser using localStorage. Use `Load master list` to restore the full seeded master list, then use the `Download bookings CSV` and `Download VIN CSV` buttons to share the latest master data.

## Shared Data For All Users

To make changes from one user appear for all other users on the same GitHub Pages link, connect Firebase Realtime Database:

1. Create a Firebase project at https://console.firebase.google.com/.
2. Add a Web app.
3. Create a Realtime Database.
4. Copy your Firebase web config.
5. Open `app.js`.
6. Paste the config values into `firebaseConfig` at the top of the file.
7. Upload the updated files to GitHub.

When Firebase is configured, the app shows `Shared live data` and all users will see the same bookings, VIN master, saves, remarks, and deletions.

Deletion password: `Bestune@2026`

Because this is a static GitHub Pages app, the password is a light safeguard only. For stronger security, use a server-backed version.
