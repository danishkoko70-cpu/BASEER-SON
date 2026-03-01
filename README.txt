Business Finance (Firebase Sync) — GitHub Pages Ready

1) Firebase Console:
   - Create project
   - Build → Firestore Database → Create database (test mode for now)
   - Project settings → Your apps → Add Web app (</>) → copy firebaseConfig

2) Open file: firebase-config.js
   - Replace `firebaseConfig = null` with your config object.

3) GitHub upload:
   - Upload ALL files in this folder to your repo root
     (index.html, app.js, app.css, firebase-config.js, 404.html)

4) Open site:
   https://<your-username>.github.io/<repo-name>/

Default login:
  admin / admin123
  manager / manager123

DATA LOCATION (Firestore):
  Collection: bf_data
  Document: main
  Field: state  (full app state as object)
  Field: updatedAt

Security (Important):
  Test mode is open for 30 days. For real use, add Firebase Authentication and secure rules.
