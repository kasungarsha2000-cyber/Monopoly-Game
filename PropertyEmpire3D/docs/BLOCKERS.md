# Blockers and environment limits

These could not be verified in the build environment (a headless Linux container with no physical devices). They are implemented, but untested on real hardware.

| Item | Status | Why |
| --- | --- | --- |
| Real phones on Wi-Fi / phone hotspot | Not tested | No physical devices or radio network available. Mobile layout and touch were tested with Playwright's Pixel 7 emulation against the production build. |
| Router client isolation, Windows/macOS firewall prompts | Not tested | Requires real networks and desktop OSes. Documented in README Troubleshooting. |
| Safari / Firefox / iOS WebKit | Not tested | Only Chromium (headless, SwiftShader WebGL) is installed. The code uses standard WebGL1/2 via Three.js r180, standard WebSocket and IndexedDB. |
| Real GPU performance (60 fps target, phone thermals) | Not measured | Tests use software rendering. The renderer draws only when something changes, caps device pixel ratio at 2, and has Low/Medium/High presets. |
| Service-worker offline solo play | Not tested | Service workers need HTTPS or localhost; not exercised in automated tests. |
| HTTPS/WSS reverse proxy | Not tested | Documented example configs only. |
| Android app on a real phone or emulator | Not tested | No Android emulator can run here (no hardware virtualization, and Google's SDK download server, dl.google.com, is blocked by the environment's network policy). The APK was built with Ubuntu's Android SDK packages (platform 23, aapt, dx, apksigner) and checked statically (`aapt dump badging`, `apksigner verify`, dex contents). The game page it contains passed a Playwright test that recreates the app's origin, content policy and bridge on a Pixel 7 viewport. |

No blocking issues remain for local development, solo play or localhost LAN play.
