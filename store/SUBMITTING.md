# Submitting Double Click AI

Publisher: LARE, LLC. Developer account: lonny@larehq.com. Privacy policy: https://dcai.larehq.com/privacy.

The extension is not on the Chrome Web Store until this upload is approved. Do not describe it as already listed.

`short_name` in the manifest is `DC AI` (5 characters). The store limit is 12, and `Double Click AI` is 15. `DoubleClickAI` is 13, so it does not fit either, and cutting it to 12 characters produces `DoubleClickA`. `DoubleClick` fits at 11 but drops AI. `DC AI` stays under the limit and keeps both the initials and AI. Chrome uses it where the full name does not fit. The listing name stays `Double Click AI`.

## Upload

1. From the repo root, run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run package`. `npm test` and `npm run package` build first.
2. Upload `dist/double-click-ai-<version>.zip`. The zip is the compiled `dist/extension` folder only (the esbuild output Chrome loads), not the TypeScript sources. Its manifest has no `key`. Leave the key in `extension/manifest.json`. The unpacked dev build in `dist/extension` keeps that key, so unpacked installs keep the id `dkaimfjbcdiaeialfejfhppmlmcafabc`.
3. Fill the listing from `store/listing.md`: name, summary, description, category (Productivity), language (English), single purpose, permission justifications, remote code (none), and the data-use disclosures.
4. Privacy policy URL: `https://dcai.larehq.com/privacy`.
5. Upload `store/icon128.png` (128×128). It is the same two-dot icon as `extension/icons/icon128.png`.
6. Upload the 1280×800 screenshots in `store/screenshots/`: `highlight.png` (popup on a highlighted passage), `chat.png` (multi-turn chat), `history.png` (history panel), `providers.png` (providers screen).
7. Upload `store/promo-small.png` (440×280) and `store/promo-marquee.png` (1400×560).

The screenshots are the extension running. Regenerate them with `npm run capture:store` if the UI changes. Branded Chrome ignores `--load-extension`, so set `CHROME_PATH` to Chrome for Testing when you need that flag. Regenerate the promo tiles and refresh the icon copy with `npm run render:store`.

## After the first upload

The store assigns an extension id that is different from the unpacked id. Until that id is on the helper allowlist, the packaged extension cannot start the helper.

1. Copy the assigned id from the developer dashboard.
2. Add it to `STORE_EXTENSION_IDS` in `helper/src/constants.ts`. The unpacked id stays in that file and is always allowed.
3. Run `npm run build` and `node install.js` again, then restart Chrome. The installer writes every id into the native host manifest's `allowed_origins` and points the launcher at `dist/helper/host.js`.
4. To register an id before you commit the constant, run `node install.js --extension-id <store-id>`. Repeat the flag, or separate ids with commas, to allow more than one. Then restart Chrome. Still add the id to `STORE_EXTENSION_IDS` so the next install from a clean checkout keeps it.
5. In `site/public/config.js`, set `chromeWebStoreUrl` to the listing URL, `https://chromewebstore.google.com/detail/<store-id>`. Every "Add to Chrome" link reads that value. Leave it on the GitHub install anchor until the listing is actually published.
