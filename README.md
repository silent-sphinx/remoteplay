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

## Deploy on Linux

The production app can run as a `systemd` service and start automatically at boot.

Install Node.js, npm, and the server-side audio player:

```bash
sudo apt update
sudo apt install -y git mpv nodejs npm
```

Next.js 16 requires Node.js 20 or newer. Install the project under `/opt/remoteplay`, then configure and build it:

```bash
sudo mkdir -p /opt/remoteplay
sudo chown "$USER":"$USER" /opt/remoteplay
git clone <repository-url> /opt/remoteplay
cd /opt/remoteplay
npm ci
cp .env.example .env.local
```

Edit `.env.local` with the Navidrome connection details:

```env
NAVIDROME_URL=http://your-navidrome-host:4533
NAVIDROME_USER=your-username
NAVIDROME_PASSWORD=your-password
```

Build the production app:

```bash
npm run build
```

### Option 1: System service with ALSA

Use a system service for a headless Raspberry Pi or other machine using a directly attached ALSA device such as HDMI, USB audio, or the headphone jack. Create a dedicated service user and give it access to the audio device:

```bash
sudo useradd --system --home /opt/remoteplay --shell /usr/sbin/nologin remoteplay
sudo usermod -aG audio remoteplay
sudo chown -R remoteplay:remoteplay /opt/remoteplay
sudo chmod 600 /opt/remoteplay/.env.local
```

Create `/etc/systemd/system/remoteplay.service`:

```ini
[Unit]
Description=RemotePlay Navidrome controller
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=remoteplay
Group=remoteplay
WorkingDirectory=/opt/remoteplay
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
ExecStart=/usr/bin/npm start -- --hostname 0.0.0.0
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now remoteplay
sudo systemctl status remoteplay
```

RemotePlay is then available at `http://<linux-host-ip>:3000`. View runtime logs with:

```bash
sudo journalctl -u remoteplay -f
```

To update an existing installation:

```bash
cd /opt/remoteplay
git pull
npm ci
npm run build
sudo systemctl restart remoteplay
```

### Option 2: User service with PulseAudio or PipeWire

Use a user service when audio is managed by a logged-in desktop user's PulseAudio or PipeWire session. Run the setup below as that audio user, replacing `your-user` with the Linux username:

```bash
sudo loginctl enable-linger your-user
mkdir -p /home/your-user/.config/systemd/user
```

Create `/home/your-user/.config/systemd/user/remoteplay.service`:

```ini
[Unit]
Description=RemotePlay Navidrome controller
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/remoteplay
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
ExecStart=/usr/bin/npm start -- --hostname 0.0.0.0
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Make sure the user service account can read the project and `.env.local`, then enable it:

```bash
sudo chown -R your-user:your-user /opt/remoteplay
systemctl --user daemon-reload
systemctl --user enable --now remoteplay
systemctl --user status remoteplay
```

View logs with:

```bash
journalctl --user -u remoteplay -f
```

Do not run both service options at the same time because they would both try to use port 3000.

## Server audio

Playback comes from the machine running RemotePlay, not the browser. Install one supported command-line player on that machine:

```bash
# macOS
brew install mpv

# Debian/Ubuntu/Raspberry Pi OS
sudo apt install mpv
```

RemotePlay prefers `mpv`, then falls back to `ffplay` or `mpg123`. The browser is only a remote control and can be closed without stopping the server process immediately.

For reliable per-output selection and seamless live volume control, install `mpv`. On macOS, `ffplay` and `mpg123` can play through the system default output, but they cannot expose selectable CoreAudio outputs; RemotePlay applies their volume changes by restarting the current track at its existing position.

## Included controls

- Album browsing with Navidrome cover art
- Artist and track views
- Album queueing and next/previous playback
- HTML5 audio streaming through the local server
- Volume control and responsive layout for a Pi display or phone