// Paste your Firebase web app config here (from Firebase Console → Project settings → Your apps → Web app)
//
// Example:
// export const firebaseConfig = {
//   apiKey: "XXXX",
//   authDomain: "XXXX.firebaseapp.com",
//   projectId: "XXXX",
//   storageBucket: "XXXX.appspot.com",
//   messagingSenderId: "XXXX",
//   appId: "XXXX"
// };

rules_version = '2';
service cloud.firestore {
match /databases/{database}/documents {
match /{document=**} {
allow read, write: if true;
}
}
}
