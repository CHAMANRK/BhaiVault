# 🔐 BhaiVault — Setup Instructions

## Files List
```
index.html        ← Main app (ye browser mein kholo)
manifest.json     ← PWA ke liye (same folder mein rakho)
sw.js             ← Offline support (same folder mein rakho)
firestore.rules   ← Firebase rules (console mein paste karo)
```

---

## Step 1 — Firestore Rules Set Karo

1. Firebase Console kholo → https://console.firebase.google.com
2. Apna project "bhaivault" select karo
3. Left sidebar → **Firestore Database** → **Rules** tab
4. `firestore.rules` file ka content copy karo
5. Rules editor mein paste karo
6. **"Publish"** button dabao

---

## Step 2 — App Use Karna

Sab 3 files ek hi folder mein rakho:
```
myfolder/
  ├── index.html
  ├── manifest.json
  └── sw.js
```

Phir `index.html` browser mein kholo.

---

## Step 3 — Phone Pe Install Karna (PWA)

### Android (Chrome):
1. Chrome mein app kholo
2. Top right → 3 dots menu
3. **"Add to Home Screen"** ya **"Install App"**
4. Done! App icon phone pe aa jayega

### iPhone (Safari):
1. Safari mein kholo
2. Bottom → Share button (box with arrow)
3. **"Add to Home Screen"**
4. Done!

---

## App Use Kaise Karo

### Pehli baar:
1. **"Pehli baar? Setup karo"** pe click karo
2. Naam, DOB, Secret Word bharo
3. Apna 4-digit PIN set karo (yaad rakho ORDER!)
4. Done!

### Unlock karna:
- Floating numbers mein se apne 4 sahi numbers
- SAHI ORDER mein tap karo
- App khul jayega!

### Password add karna:
- Vault tab mein **"+"** button dabao
- App naam, username, password, note bharo
- Emoji icon chuno
- "Share with nominees" check karo agar share karna ho
- Save!

### Nominee add karna:
- Nominees tab mein jao
- Apna **Link Code** nominee ko do
- Nominee ka code leke "Add Nominee" mein daalo
- Done! Max 3 nominees

### PIN bhool gaya:
1. **"PIN bhool gaya? Recovery"** link dabao
2. Naam, DOB, Secret Word daalo
3. Recovery code generate hoga
4. Wo code nominee ko batao (call/WhatsApp pe)
5. Nominee apni app mein approve kare
6. Code verify karo → Done!

---

## Kya Kya Features Hain

| Feature | Details |
|---------|---------|
| 🔑 Vault | Saare passwords ek jagah |
| 🔍 Search | App naam se dhundo |
| 👁️ Show/Hide | Password reveal karo |
| 📋 Copy | Ek tap mein copy |
| 🎲 Generate | Strong password banana |
| ⭐ Favourite | Important passwords pin karo |
| 📱 Screen Lock | Phone lock bhi save karo |
| 🔗 Share | Nominees ke saath share karo |
| 👥 Nominees | Max 3, chain recovery system |
| 🆘 Recovery | PIN bhulne pe bhai se help lo |
| 📵 Offline | Internet nahi ho tab bhi kaam kare |

---

## Chain Recovery Kaise Kaam Karta Hai

```
X → PIN bhool gaya → Y se maanga
Y → PIN bhool gaya → Z se maanga  
Z → Yaad hai → Y ko approve kiya
Y → Unlock hua → X ko approve kiya
X → Unlock ho gaya ✅
```

---

## Important Notes

- **PIN order matter karta hai** — same numbers alag order mein = galat
- **Secret Word yaad rakho** — recovery ke liye zaroori hai
- **Nominee carefully chuno** — wo tumhara data access kar sakte hain (shared entries)
- **Circular chain nahi banegi** — app automatic detect kar lega

---

*BhaiVault — Kyunki bhai ka data bhai ke paas safe rehta hai* 🔐
