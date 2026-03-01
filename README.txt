Business Finance — GitHub Pages Ready (Local Mode + Optional Firebase Sync)

✅ Works LIVE on GitHub Pages even WITHOUT Firebase (Local Mode).
✅ If you add Firebase config, it will sync data online across devices.

A) LIVE (without Firebase) — easiest
1) Upload all files to your GitHub repo (root):
   index.html, app.js, app.css, firebase-config.js, 404.html, sw.js, etc.
2) Enable GitHub Pages (Settings → Pages).
3) Open your link. You will see: Sync: LOCAL MODE

B) Enable Online Sync (Firebase) — optional
1) Firebase Console:
   - Create project
   - Build → Firestore Database → Create database (test mode for now)
   - Project settings → Your apps → Add Web app (</>) → copy firebaseConfig
2) Open file: firebase-config.js
   - Replace `firebaseConfig = null` with your config object.
3) Commit & push again. Refresh the website.
   - Sync badge will change to Connected / Saving etc.

C) Company Logo + Invoice Details
Go to Settings:
- Company Name, Currency, Phone, Email, Address
- Upload Logo (PNG/JPG)
Then open any entry → Invoice → Print/Save PDF.

Default login:
  admin / admin123
  manager / manager123

Notes:
- In Local Mode, data is saved in your browser (localStorage).
- For real online usage, secure Firestore rules and add Auth later.
