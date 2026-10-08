# Next steps

1. Play-test on real devices: one laptop running `npm run start:lan`, two or more phones on the same Wi-Fi, then on a phone hotspot. Record results in `TEST_RESULTS.md`.
2. Run the Playwright suite against Firefox and WebKit (`npx playwright install firefox webkit`, then add projects to `playwright.config.ts`).
3. Measure frame rate on a low-end phone with Graphics = Low and tune the board texture size if needed.
4. Optional polish from the brief's nice-to-have list: alternative board themes (the board is pure data), more tokens, extended statistics, an in-lobby QR code for the invite link.
5. Optional: let hosts reopen a finished or older saved LAN room from a list (saved rooms with unfinished games are already restored automatically on server start).
