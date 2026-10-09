# Next steps

1. Install the Android APK on a few real phones (Android 7 to 15): check first launch, rotation, back button, sound, leaving and returning to the app, and that an update installed over an older copy keeps the saved game.
2. For Google Play: build with Android Studio's SDK, target SDK 35+, check edge-to-edge insets, and produce a signed app bundle (see BUILD.md).
3. Play-test on real devices: one laptop running `npm run start:lan`, two or more phones on the same Wi-Fi, then on a phone hotspot. Record results in `TEST_RESULTS.md`.
4. Run the Playwright suite against Firefox and WebKit (`npx playwright install firefox webkit`, then add projects to `playwright.config.ts`).
5. Measure frame rate on a low-end phone with Graphics = Low and tune the board texture size if needed.
6. Optional polish from the brief's nice-to-have list: alternative board themes (the board is pure data), more tokens, extended statistics, an in-lobby QR code for the invite link.
7. Optional: let the Android app join LAN games hosted by a computer (needs cleartext WebSocket access to the LAN and the app origin added to the server's allowed origins).
8. Optional: let hosts reopen a finished or older saved LAN room from a list (saved rooms with unfinished games are already restored automatically on server start).
