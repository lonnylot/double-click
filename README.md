# Double Click AI

Highlight a passage on any page and ask about it, without leaving the page. Answers come from the AI command-line tools you are already signed into, on this computer. A LARE, LLC product.

## What you can do

- Select text. A small Ask button appears by the highlight. Click it, or press Alt+Shift+D.
- The passage stays attached to the conversation as context. Follow-up questions continue the same thread, and replies stream in as formatted text.
- The toolbar icon opens a history of pages, highlights, and conversations. Search them, reopen one to continue, or delete a conversation or a whole page.
- Pick which signed-in tool answers. Nothing in Double Click AI asks for an API key.

The chat is drawn in a shadow root, so the page’s styles do not restyle it, and Double Click AI does not restyle the page.

## Subscriptions that work

Double Click AI does not sell model access. It starts the CLI you installed and already logged in:

| Tool | Command | Account |
| --- | --- | --- |
| Codex | `codex` | ChatGPT sign-in |
| Copilot | `copilot` | GitHub Copilot |
| Antigravity | `agy` | Google AI account |
| Grok | `grok` | SuperGrok or X Premium+ |
| Cursor | `cursor-agent` | Cursor account |
| Claude Code | `claude` | Claude subscription, off until you enable it |

**Claude Code is opt-in.** Anthropic’s terms do not allow third-party products to route requests through Claude plan credentials. Double Click AI only launches the `claude` program already on your machine, never passes `--bare` (that mode skips subscription login), and never reads Claude credential files. Enable it only if that arrangement is acceptable for your account. The switch is in the chat, next to the provider list, and again under Providers in history.

A Sample reply provider is included so you can try the popup before any CLI is installed. It does not contact a model.

Each run uses an empty temporary folder, read-only or no-tool flags where the CLI documents them, and a cleaned environment. These variables are removed so a CLI does not silently switch from your subscription to metered API billing: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `XAI_API_KEY`, `CODEX_API_KEY`, `GEMINI_API_KEY`, `CURSOR_API_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`, `COPILOT_GITHUB_TOKEN`, and the same vendors’ other `*_API_KEY` / `*_TOKEN` variables. Double Click AI does not read `~/.codex`, `~/.claude`, `~/.grok`, or other CLI login files.

If a CLI is missing or not signed in, the chat shows the install or login command instead of a blank failure.

## Install

You need Node.js 18 or newer, and Google Chrome.

1. Load the extension unpacked. Open `chrome://extensions`, turn on Developer mode, choose Load unpacked, and select the `extension` folder in this repo.
2. Confirm the extension id is `dkaimfjbcdiaeialfejfhppmlmcafabc`. The id is pinned with the public `key` in `extension/manifest.json`, so an unpacked install matches the native host allowlist. That key is an extension identity, not a secret.
3. From this folder, register the local helper:

   ```bash
   node install.js
   ```

   The installer writes a Chrome native-messaging host for Chrome, Chromium, Edge, and Brave on macOS and Linux, and the HKCU registry entries plus a `.cmd` launcher on Windows. It records the absolute path to this repo’s `helper/host.js` and a stable path to Node: the Homebrew `opt` symlink (for example `/opt/homebrew/opt/node@24/bin/node`) when Node is a versioned Cellar build, otherwise the `command -v node` entry without resolving that symlink. Run `node install.js` again after you pull updates, move the repo, or upgrade Node, then restart Chrome so it relaunches the helper. `node install.js --uninstall` removes the registration.

4. Sign in to the CLIs you want to use, in a terminal:

   ```bash
   npm install -g @openai/codex && codex login
   npm install -g @github/copilot && copilot login
   # Antigravity: install the agy CLI, then run agy once to sign in
   curl -fsSL https://x.ai/cli/install.sh | bash && grok login
   curl https://cursor.com/install -fsS | bash && cursor-agent login
   npm install -g @anthropic-ai/claude-code && claude auth login
   ```

5. Highlight text on a normal web page and click Ask. Choose a provider in the popup. Open history from the toolbar icon, or from the menu button in the chat.

The helper speaks only to the unpacked extension `chrome-extension://dkaimfjbcdiaeialfejfhppmlmcafabc/` and any Chrome Web Store id you add. It is started by Chrome over native messaging. There is no listening port.

The unpacked id is always allowed. After the Chrome Web Store assigns an id, add it to `STORE_EXTENSION_IDS` in `helper/src/constants.js` and run `node install.js` again. You can also pass ids without editing that file. Repeat the flag, or separate ids with commas:

```bash
node install.js --extension-id <store-id>
node install.js --extension-id <id-one>,<id-two>
```

Restart Chrome after registering the host so it relaunches the helper.

Binaries are invoked by name: `grok`, `cursor-agent`, `codex`, `copilot`, `agy`, `claude`. The helper looks them up on your login shell’s PATH, plus the usual install directories (`~/.local/bin`, `~/.grok/bin`, Homebrew, npm, nvm, Volta, fnm, asdf), because Chrome’s own PATH is only `/usr/bin:/bin:/usr/sbin:/sbin` when it is launched from the Dock. The generic `agent` command is never used, because Grok and Cursor have both shipped it. The Providers section of history shows the path that will run, and you can set an absolute path for one tool there.

## How a turn runs

The page content script shows the popup and talks to the extension service worker. The worker stores the conversation in IndexedDB and holds the native-messaging port. The helper spawns one CLI process per turn in an empty temp directory, maps the conversation id to that CLI’s session id (Codex `thread_id`, Claude `session_id`, Grok `-s`, Copilot `--session-id`, Cursor `--resume`, Antigravity `--conversation`), and turns each CLI’s streaming JSON into the same events: session, text deltas, done, or error. Host messages larger than the 1 MB Chrome limit are split into chunks and reassembled in the service worker.

Flag and event details that were checked against current docs are noted at the top of each file in `helper/src/providers/`. Parsers ignore unknown fields and tool chatter. When a resume flag is missing or the CLI prints plain text instead of JSON, the helper keeps the plain stdout as the answer.

## Development

```bash
npm install
npm test
npm run lint
npm run package
```

`npm run package` writes `dist/double-click-ai-<version>.zip` containing only the files in `extension/`. The zip manifest omits `key`, which the Chrome Web Store rejects. The key stays in `extension/manifest.json` so an unpacked install keeps the id `dkaimfjbcdiaeialfejfhppmlmcafabc`. See `store/SUBMITTING.md` for the upload checklist.

Tests cover adapter parsers against fixture streams, argument shape (including the Claude and Cursor constraints), session-id storage, environment stripping, message chunking, the installer paths for macOS, Linux, and Windows, a fake Codex process, and the mock provider through the real native-messaging frames.

`npm run capture` loads the unpacked extension in headless Chrome, asks the sample provider about `demo/article.html`, and writes popup and history screenshots. Run `node install.js` first so Chrome can start the helper. Branded Chrome ignores `--load-extension`; point `CHROME_PATH` at Chrome for Testing when you need that flag.

## Site

The landing page is a static site in `site/` for [dcai.larehq.com](https://dcai.larehq.com). It deploys as a Cloudflare Worker with static assets and no Worker script. The Worker name is `dcai-site`. `site/wrangler.jsonc` serves `site/public`, uses `404.html` for unknown paths, and keeps `dcai.larehq.com` attached with a Workers custom domain route.

```bash
cd site
npx wrangler deploy
```

The site is already live at [dcai.larehq.com](https://dcai.larehq.com). `npx wrangler deploy` from `site/` publishes the assets and keeps that custom domain because `routes` is set in `site/wrangler.jsonc`.

`site/public/config.js` is where “Add to Chrome” points. `chromeWebStoreUrl` currently opens the install instructions in this repository. When the extension is listed, replace it with the Chrome Web Store URL.

Fonts on the site are self-hosted (Newsreader, Plus Jakarta Sans, and IBM Plex Mono) under the SIL Open Font License. The license texts are in `site/public/fonts/`.
