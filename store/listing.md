# Chrome Web Store listing

Publisher: LARE, LLC
Developer account: lonny@lonnylot.com
Privacy policy: https://dcai.larehq.com/privacy

Paste each section below into the matching dashboard field. The description is plain text.

## Name

Double Click AI

## Summary

Highlight a passage and ask about it in place, using the AI tools you already sign in to. A LARE, LLC product.

## Description

Double Click AI lets you highlight a passage on a web page and ask about it without leaving the page. The conversation stays attached to that passage. Follow-up questions continue the same thread, and replies render as formatted text.

Answers come from an AI command-line tool you already sign in to on this computer, so you use the plan you already have. Double Click AI does not sell model access and does not ask for an API key. You pick the tool in settings, and the list of supported tools is at https://dcai.larehq.com

A sample reply mode is included so you can try the popup before any tool is installed. It stays on this computer.

The toolbar icon opens a history of the pages, highlights, and conversations stored in this browser. You can search them, reopen one, or delete a conversation or a whole page.

Double Click AI needs a one-time local helper install. The helper is not inside the extension package. Chrome starts it on your computer so a question can reach the tool you picked. There is no listening port. You need Node.js 18 or newer. Follow the Install steps in the README:

https://github.com/lonnylot/double-click#install

Highlights and questions go only to the tool you pick, through that tool's own program. History stays in this browser. There is no Double Click AI account, and LARE, LLC does not run a server that receives your chats. The privacy policy is at https://dcai.larehq.com/privacy

A LARE, LLC product.

## Category

Productivity

## Language

English

## Single purpose

Highlight text on a page and ask a question about that passage, using an AI tool the user already signs in to on their computer.

## Permissions

The manifest requests these permissions and no others.

### storage

`chrome.storage.local` stores the settings the user chooses: the selected provider, whether Claude Code is enabled, and any optional absolute path for a tool. `chrome.storage.session` stores a revision counter so the history view refreshes after a conversation changes. Passages and chats are not stored under this permission. They live in the extension's IndexedDB database in this browser.

### nativeMessaging

Connects Chrome to the local helper `com.lare.doubleclick`. The helper is a program the user installs once. Chrome starts it to run the AI tool the user picked for that turn. The helper does not open a listening port.

### sidePanel

The history view is `history.html`, shown in the side panel. The toolbar icon opens that panel (`openPanelOnActionClick`). The same page can be opened in a tab from the panel.

### contextMenus

Adds one menu item, "Ask Double Click AI", when text is selected, so the user can open the chat on that selection.

## Host access

The manifest does not declare `host_permissions`. There are no optional host permissions.

Content scripts match `http://*/*` and `https://*/*`. That is the host access. The Ask button has to appear when the user selects text on an ordinary web page, before they click the toolbar icon, so an `activeTab` grant would show up too late. On a turn the user starts, the script reads the current selection plus that page's title and URL. It does not send the rest of the page. It does not run on `chrome://` pages, the Chrome Web Store, `file://` URLs, or other extensions.

## Remote code

None.

The extension package contains all of its JavaScript. It does not load scripts from a server, download code at runtime, call `eval`, or construct functions from remote strings. It does not fetch WebAssembly. Replies are produced by command-line programs the user installs on their computer. Those programs are not part of this package, and the extension does not download them.

## Data use

These disclosures match the privacy policy at https://dcai.larehq.com/privacy. LARE, LLC operates Double Click AI. There is no Double Click AI account. LARE, LLC does not run a server that receives highlights or chats.

What a turn sends, and where it goes. When the user highlights a passage and asks a question, that turn goes only to the official command-line tool for the provider they pick. The helper starts that program on their computer, using the sign-in they already have. The following go to that provider, and nowhere else:

- the highlighted passage
- the page title
- the page URL
- the question they type, and earlier messages in that same conversation when they ask a follow-up

The provider's own terms and privacy policy then apply. Double Click AI does not keep a copy of the turn for itself. It does not ask for an API key. The helper removes API-key environment variables so a tool does not silently switch to metered billing. The helper does not read the login files those tools keep on disk.

What stays on the computer. Pages, highlights, and conversations are stored in this browser, in the extension's local database. Double Click AI does not upload that history. The user can search it, reopen a thread, or delete a conversation or a whole page from the side panel. The helper keeps a local map from a conversation to that provider's session id, in a file under the home directory, so a follow-up can resume. That file holds the provider name and the session id. It does not hold the passage, the page, or the question.

What the extension can see. On pages the user visits, it can read the text they select, plus the title and URL of that page, so it can show Ask and send the turn they start. It does not send other page content. It does not read browsing history as a list of sites. The toolbar icon opens history stored by the extension itself.

This website. https://dcai.larehq.com is a static site. It does not set cookies, does not ask anyone to sign in, and does not run analytics.

Analytics. The extension, the helper, and the website do not include analytics.

Selling and sharing. LARE, LLC does not sell personal information and does not share highlights or questions with anyone other than the provider the user chooses for that turn. There is no advertising in the extension.

Children. Double Click AI is not directed at children under 13, and LARE, LLC does not knowingly collect personal information from them.

Dashboard checkboxes, filled to match the policy:

- Disclose website content. The highlighted passage, the page title, and the page URL of a turn the user starts are sent to the provider they pick.
- Do not disclose web history. The extension does not read or upload the browser's list of visited sites. The URL of the page they are asking about is part of that turn and is covered as website content.
- Do not disclose personally identifiable information, health information, financial or payment information, authentication information, personal communications, location, or user activity. The extension does not ask for those, does not run analytics, and does not read login files or API keys. A highlight the user chooses to send can contain whatever was on the page. That text goes only to the provider they pick. LARE, LLC does not receive a copy.
- Certify that user data is not sold or transferred to third parties outside the single purpose. The transfer that does happen is the turn the user starts, sent only to the provider they pick.
- Certify that user data is not used for purposes unrelated to that single purpose.
- Certify that user data is not used to determine creditworthiness or for lending.
