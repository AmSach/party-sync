# ⚡ PartySync — Multi-Device Audio & Movie Sync Mesh

> **Turn everyone's smartphones, laptops, and Bluetooth speakers into a unified, synchronized sound system.**

Play movies, Spotify, or music on a TV or laptop screen, and stream the audio in real-time lockstep synchronization across all connected phones and speakers scattered around the room.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

---

## 🌟 Why PartySync?

- 🍿 **Watch Movies Together (Virtual Surround Sound)**: Play Netflix, YouTube, or 4K movies on your laptop or TV screen. Put phones on the left side of the room, right side, and behind the couch. PartySync streams the movie dialogue and audio in lockstep!
- 🎵 **Spotify & Music Anywhere**: Capture any audio playing on your computer (Spotify desktop app, web player, SoundCloud, Apple Music) and turn 5 friends' phones into a room-filling distributed soundstage.
- ⚡ **Sub-20ms Low Latency (Local WebRTC Mesh)**: Uses WebRTC direct peer-to-peer connection. Audio packets travel directly over your local Wi-Fi router (LAN), avoiding internet server lag.
- 📱 **Zero Install Hassle**: Works on **iPhone, Android, iPad, Mac, Windows, Linux, and Smart TVs**. Just scan the on-screen QR code to join in 2 seconds!
- 🎧 **Spatial Channel Placement**: Assign phones as **Left Channel (L)**, **Right Channel (R)**, **Full Stereo**, or **Subwoofer / Bass (Low-Pass Filter)**.
- ⏱️ **Acoustic Lip-Sync & Delay Calibration**: Built-in sliders (-200ms to +300ms) to calibrate Bluetooth speaker DAC processing delay and ensure actor lips match dialogue 100%.
- 🔋 **Screen Wake Lock**: Automatically prevents phones from falling asleep or locking while music or movies are playing.

---

## 🚀 Instant Deployment to Vercel

### Option 1: 1-Click Deploy via Vercel Dashboard
1. Push this repository to your GitHub account.
2. Go to [Vercel](https://vercel.com/new).
3. Import your `party-sync` repo.
4. Click **Deploy**! (Vite framework preset is auto-detected).

---

## 💻 Local Development

```bash
# Clone the repository
git clone https://github.com/AmSach/party-sync.git
cd party-sync

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

---

## 🛠️ How It Works Under the Hood

```
                 [ TV / LAPTOP SCREEN (Host Broadcast Hub) ]
              • Plays Movie (Netflix / YouTube / VLC / Spotify)
              • Captures audio loopback via getDisplayMedia
              • Displays dynamic Room QR Code
                                    │
                                    ▼
                     [ DIRECT LOCAL Wi-Fi P2P MESH ]
                   (WebRTC RTP Isochronous Audio Pipe)
                                    │
      ┌─────────────────────────────┼─────────────────────────────┐
      ▼                             ▼                             ▼
[ FRIEND 1: iPhone ]      [ FRIEND 2: Android ]         [ FRIEND 3: Tablet ]
Role: Left Speaker (L)    Role: Right Speaker (R)       Role: Subwoofer / Bass
Delay: 0ms                Delay: 0ms                    Delay: -15ms
      │                             │                             │
      └─────────────────────────────┼─────────────────────────────┘
                                    ▼
       🔥 MASSIVE DISTRIBUTED ZERO-LAG ROOM-FILLING SURROUND SOUND!
```

---

## 📄 License
MIT License. Built for zero-cost, high-fidelity party soundscapes.
