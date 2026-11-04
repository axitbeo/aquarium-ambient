# Aquarium Ambient V1

A self-contained animated aquarium clock designed for iPad landscape.

## Included
- `index.html`: complete HTML/CSS/JS interface; fish, bubbles, underwater lighting, live clock and date.
- `manifest.webmanifest`: PWA settings.
- `service-worker.js`: caches the app for offline use after first successful visit.
- `icons/`: app icons.

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
5. Open the new Aquarium icon once while online so the service worker can cache the files.
6. Test offline by enabling Airplane Mode and reopening the app.

## Usage
- Tap anywhere to reveal controls.
- `Clock on/off` hides or shows the clock.
- `Motion pause/resume` pauses or resumes animations.
- `Full screen` requests browser fullscreen where supported. Home Screen standalone mode is more immersive on iPad.
- Landscape orientation is recommended. Rotate iPad to landscape and disable Rotation Lock if needed.

## Notes
- No external libraries, fonts, images, API calls, analytics, or account are used.
- Clock and date use the iPad's local time and locale.
- No weather is included in V1.
- Keep brightness moderate and avoid heat during long ambient sessions.
