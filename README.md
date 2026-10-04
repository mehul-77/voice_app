# StealthVoice — Ultra-Lightweight Voice Calling App

A lightweight, firewall-resilient Progressive Web App (PWA) designed for personal voice calling across restricted networks (e.g., UAE to India) and ultra-weak mobile connections (2G/3G/poor Wi-Fi).

---

## Key Features

- **Cross-Platform:** Works seamlessly on **iPhone (iOS Safari)**, **Android (Chrome)**, and **Computers (Mac/Windows/Linux)**.
- **Firewall & ISP DPI Bypass:** Supports **Stealth Mode (Force TCP 443 TURNS)**. Encapsulates voice traffic in standard TLS packets so firewalls cannot distinguish it from HTTPS web traffic.
- **Crystal Clear on Weak Internet:** Opus codec tuned for **8–12 kbps** with **Forward Error Correction (FEC)** enabled to recover dropped packets without delay.
- **Zero Cost & Private:** End-to-End encrypted via WebRTC SRTP/DTLS. No accounts, phone numbers, or third-party tracking.
- **Installable PWA:** Can be added to the mobile home screen to look and feel like a native mobile app.

---

## Instant Setup & Live Public Link

From this folder, run:

```bash
# 1. Install dependencies
npm install

# 2. Launch with instant worldwide public HTTPS link
npm run tunnel
```

The script will give you a public URL (e.g. `https://random-name.loca.lt`). Share this link with the other party in UAE or India!

---

## How to Install as an App

- **On iPhone:** Open the link in **Safari**, tap the **Share** button, and tap **"Add to Home Screen"**.
- **On Android:** Open the link in **Chrome**, tap the three dots **(⋮)**, and tap **"Install App"** or **"Add to Home Screen"**.
- **On Computer:** Open in Chrome, Edge, or Brave and click the install icon in the address bar.

---

## 24/7 Free Cloud Hosting (Render.com)

If you don't want to keep your computer running:
1. Create a free account at [Render.com](https://render.com).
2. Upload this folder to a GitHub repository.
3. On Render, click **New +** -> **Blueprint**, connect your repo.
4. Render will deploy it automatically and give you a permanent free `https://your-app.onrender.com` link!
