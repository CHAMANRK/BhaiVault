# 🔐 BhaiVault

> **Tumhara personal password vault — sirf tumhare device mein. Koi cloud nahi, koi server nahi, koi Firebase nahi.**

---

## ✨ Features

- 🔢 **Floating Number PIN Lock** — har baar numbers ki position badlti hai, shoulder surfing impossible
- 🔑 **Password Manager** — add, edit, delete, search — sab kuch
- 🎲 **Password Generator** — strong random passwords ek click mein
- ⭐ **Favourites** — important passwords upar dikhenge
- 📱 **Screen Lock Badge** — phone ka PIN alag mark karo
- 🔗 **Shared Flag** — nominees ke liye mark karo
- 👥 **Nominees** — trusted log jinka naam + code save karo
- 📤 **Export / Import** — JSON backup — kisi bhi device pe restore karo
- 🆘 **PIN Recovery** — naam + DOB + secret word se PIN reset karo
- 📲 **PWA Ready** — home screen pe install karo, native app jaisa feel

---

## 🚀 Setup Kaise Karo

Sirf ek file chahiye — **`index.html`**

```
bhaivault/
└── index.html   ← bas yehi file hai
```

### Local mein chalao

Kisi bhi browser mein `index.html` double-click karke kholo. Bas.

> ⚠️ Clipboard copy feature ke liye HTTPS ya localhost chahiye (Chrome ka restriction hai).

### Server pe deploy karo (recommended)

Koi bhi static hosting kaam karega:

| Platform | Steps |
|---|---|
| **GitHub Pages** | Repo banao → `index.html` upload karo → Settings → Pages enable karo |
| **Netlify** | netlify.com → "Deploy manually" → folder drag karo |
| **Vercel** | `vercel --prod` ya drag & drop |
| **Cloudflare Pages** | Free tier mein deploy karo |

---

## 🏗️ Architecture

### Koi backend nahi, koi database nahi

```
BhaiVault
│
├── index.html          ← poori app (HTML + CSS + JS — ek file)
│
└── localStorage        ← sab data yahan
    ├── bv_userid           → unique user ID
    ├── bv_pinhash          → PIN ka hash (plain PIN kabhi store nahi hota)
    ├── bv_userdata_cache   → naam, DOB, link code, nominees
    └── bv_passwords_<uid>  → sab passwords (JSON array)
```

### Security

| Cheez | Kaise |
|---|---|
| PIN | `simpleHash()` se hash ho ke store hota hai — plain kabhi nahi |
| Passwords | Device ke localStorage mein — koi transmission nahi |
| Recovery | Naam + DOB + Secret Word — teen cheezein milni chahiye |
| Link Code | `BHAI-XXXX-XXXX` format — randomly generated |

> 💡 Production ke liye `SubtleCrypto` (AES-256) add kar sakte ho passwords encrypt karne ke liye. Abhi localStorage mein plain JSON hai.

---

## 📖 App ka Flow

```
Pehli baar:
  App kholo → Welcome Screen → Setup (5 steps) → Vault

Baad mein:
  App kholo → Lock Screen → PIN daalo → Vault
```

### Setup ke 5 Steps

1. **Welcome** — intro
2. **Naam** — display ke liye
3. **DOB + Secret Word** — recovery ke liye
4. **PIN banao** — 4 digits
5. **PIN confirm karo** — dobara daalo

---

## 👥 Nominees System

Firebase nahi hai, isliye nominees ka system **local + export-based** hai:

1. **Apna Link Code share karo** (Nominees tab → Copy)
2. **Nominee ka code lo** aur unhe add karo
3. **Shared passwords export karo** → JSON file nominee ko bhejo
4. **Nominee import kare** apne BhaiVault mein

```
Tum  →  Export JSON  →  WhatsApp/Email  →  Nominee
                                              ↓
                                         Import kare
```

---

## 🆘 PIN Bhool Gaye?

Lock screen → **"PIN Bhool Gaya?"** button dabao

Phir yeh teen cheezein daalo jo setup mein rakhi thi:
- ✅ Poora naam
- ✅ Date of Birth
- ✅ Secret Word

Match hone par naya PIN set karo.

---

## 📤 Backup & Restore

### Export (backup lena)
`Profile` tab → **"Vault Export Karo"** → `bhaivault_backup.json` download hoga

### Import (restore karna)
`Profile` tab → **"Vault Import Karo"** → JSON file select karo → passwords merge ho jaayenge

> Existing passwords safe rehte hain — sirf naye add hote hain (duplicate IDs skip hote hain)

---

## 📲 PWA Install

App ko home screen pe install kar sakte ho:

**Android (Chrome):**
Browser menu (⋮) → "Add to Home Screen" ya Install app

**iOS (Safari):**
Share button (□↑) → "Add to Home Screen"

Ek baar install karne ke baad full-screen, offline-ready app ban jaati hai.

---

## 🔧 Customization

### Colors badlo
File ke upar CSS variables hain:
```css
:root {
  --accent: #7c6fff;    /* purple — primary color */
  --accent2: #ff5f7e;   /* pink */
  --accent3: #00e5a0;   /* green */
  --accent4: #ffd166;   /* yellow */
}
```

### Aur emojis add karo
```javascript
const EMOJIS = ['🔑','📱','💳','📧','🎮','💼','🏦', /* apne add karo */ ];
```

---

## 🤝 Firebase se BhaiVault v2 mein kya badla

| Feature | Firebase version | v2 (ye wali) |
|---|---|---|
| Storage | Firestore cloud | localStorage (local only) |
| Auth | Anonymous auth | Nahi chahiye |
| Load time | Heavy (3 CDN scripts) | Instant |
| Offline | Partial | Full |
| Errors | 403, permission denied | Koi nahi |
| Bundle size | ~500KB+ | ~30KB |
| Setup | Firebase console configure karo | Kuch nahi |
| Nominees live sync | Tha | Export/Import se karo |

---

## 📋 Browser Support

| Browser | Status |
|---|---|
| Chrome / Edge | ✅ Full support |
| Firefox | ✅ Full support |
| Safari (iOS) | ✅ Full support |
| Samsung Internet | ✅ Works |

---

## 📄 License

Personal use ke liye free hai. Apne dosto ke saath share karo. 🙌

---

<div align="center">
Made with ❤️ — No cloud. No tracking. Just your passwords.
</div>
