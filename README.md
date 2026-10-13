# RemotePlay

A lightweight Navidrome/Subsonic music controller designed to run on a Raspberry Pi.

Control music over the network via HTTP webpage, audio ALWAYS comes out of the server, not the web browser.

> [!IMPORTANT]
> This app is 100% vibe-coded, the code has undergone manual review.
> This is intended as a side-hobby project to allow my Raspberry Pi to act as a music client, not a production audio server intended for deployment.

## Configure

Copy `.env.example` to `.env.local` and fill in the Navidrome URL, username, and password. RemotePlay uses the Subsonic token authentication flow described by Navidrome.

## Run

```bash
npm install
npm run dev -- --hostname 0.0.0.0
```

Open `http://<raspberry-pi-ip>:3000` in the Pi's browser. For production, use `npm run build && npm start -- --hostname 0.0.0.0` and keep the process alive with your preferred service manager.

## Server audio

Playback comes from the machine running RemotePlay, not the browser. Install one supported command-line player on that machine:

```bash
# macOS
brew install mpv

# Debian/Ubuntu/Raspberry Pi OS
sudo apt install mpv
```

RemotePlay prefers `mpv`, then falls back to `ffplay` or `mpg123`. The browser is only a remote control and can be closed without stopping the server process immediately.

## Included controls

- Album browsing with Navidrome cover art
- Artist and track views
- Album queueing and next/previous playback
- HTML5 audio streaming through the local server
- Volume control and responsive layout for a Pi display or phone