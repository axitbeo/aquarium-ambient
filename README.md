# Aquarium Ambient V3

A self-contained aquarium clock and media player for iPad (8th gen) landscape: a library of photoreal aquarium videos with crossfades, independent music and underwater ambience, and per-item offline downloads.

## Included
- `index.html`: complete HTML/CSS/JS interface; fish, bubbles, underwater lighting, live clock and date.
- `manifest.webmanifest`: PWA settings.
- `library.js`: **the media library**: the only file to edit when adding/removing media.
- `player.js`: video crossfade player, music/ambience channels, offline downloads, player panel.
- `service-worker.js`: caches the app shell; serves downloaded media offline (with byte-range support).
- `icons/`: app icons.
- `media/`: aquarium videos and their poster images.
- `sound/`: music and underwater ambience audio.

## Media library
Folders are not scanned (static hosts can't list directories): `library.js` is the list.

- **Add**: copy the file into `media/` (video + optional 640x360 JPG poster) or `sound/`, then add one entry to `library.js`. Sounds use `type: 'music'` or `type: 'ambience'`.
- **Replace** a file under the same name: increase that entry's `v`. Devices that downloaded it show *Update available* and keep playing their copy until updated.
- **Remove**: delete the entry. Downloaded copies stay until removed via *Remove unused* in the player panel.
- Missing files are shown as *Missing* and skipped during playback.

Video spec: H.264 High, 1920x1080, 30 fps, 4–6 Mbps, no audio track, `+faststart`. Example:
`ffmpeg -i source.mp4 -map 0:v:0 -an -vf "scale=1920:1080:flags=lanczos" -r 30 -c:v libx264 -preset slow -profile:v high -level 4.0 -pix_fmt yuv420p -b:v 5M -maxrate 6M -bufsize 10M -g 60 -movflags +faststart -write_tmcd 0 media/name-1080p.mp4`

Poster: `ffmpeg -ss <seconds> -i media/name-1080p.mp4 -frames:v 1 -vf scale=640:360 -q:v 4 media/name-1080p.jpg`

Source originals are not deployed: the 4K `16011848-uhd_3840_2160_30fps.mp4` (183 MB, over GitHub's 100 MB file limit) is kept outside the repository, and `media/85674-591865490.mp4` (replaced by its `-1080p` version) is excluded by `.gitignore`.

Cache versions: bump `CACHE_NAME` in `service-worker.js` when `index.html`/`player.js` change. Never rename `MEDIA_CACHE`; media versioning is per entry (`v`).

## Important iPad installation note
For a proper Home Screen app that can work offline, serve this folder from an HTTPS website once. A local HTML file opened from Files is not the same as an installable Safari web app, and service workers require a secure origin.

Free hosting options:
- GitHub Pages (public repository)
- Netlify (free static hosting tier)

After opening the HTTPS URL in Safari on iPad:
1. Tap Share.
2. Choose Add to Home Screen.
3. Enable Open as Web App if that option appears.
4. Tap Add.
5. Open the new Aquarium icon once while online. Open **Player** and tap **Download** on each video/track you want offline (nothing large downloads automatically).
6. Test offline by enabling Airplane Mode and reopening the app.

## Usage
- Tap anywhere to reveal controls.
- `Clock on/off` hides or shows the clock.
- `Player` opens the player panel: Video / Music / Ambience tabs, Loop One / Loop All / Shuffle, Prev / Next, volume, and per-item Download / Update / Remove with status (Available, Downloading, Cached, Update available, Missing).
- `Motion pause/resume` pauses or resumes animations and the video.
- `Sound on/off` is the master switch for music and ambience (each can also be turned off in the panel). Selections and modes are remembered; iOS requires a tap before sound can start, so it resumes on your first tap.
- `Full screen` requests browser fullscreen where supported. Home Screen standalone mode is more immersive on iPad.
- Landscape orientation is recommended. Rotate iPad to landscape and disable Rotation Lock if needed.

## Notes
- No external libraries, fonts, API calls, analytics, or account are used. All media is local.
- The screen is kept awake where Safari supports the Wake Lock API (iPadOS 16.4+); otherwise set Auto-Lock to Never during ambient sessions.
- Clock and date use the iPad's local time and locale.
- No weather is included.
- Keep brightness moderate and avoid heat during long ambient sessions.
