# DeepSeek Harness — Linux Edition

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Version: 0.1.0](https://img.shields.io/badge/version-0.1.0-blue.svg)
![Platform: Linux x86_64](https://img.shields.io/badge/platform-Linux%20x86_64-lightgrey.svg)

**Version 0.1.0 · Ubuntu/Debian · x86_64**

A community rebuild of DeepSeek Harness for Linux: one-command install, full desktop integration, original dolphin branding, and a local-first setup — your models, your keys, no account required.

---

## Inspiration

This project started from a simple frustration: the stock app was hard to install on Linux, carried branding we could not ship, and pushed sign-in and external feedback pages that got in the way of just *trying* it.

So we rebuilt it around three goals:

- **Easy installation** — a single `.deb` package that drops straight into your app menu with the right icons.
- **Original branding** — every factory image was removed from the project and replaced with our own dolphin mark, so there are no copyright surprises.
- **Local-first** — bring your own API key, run your own models, keep your data on your device. No vendor login, no telemetry-shaped detours.

Everything below was built toward those goals.

---

## What we rebuilt & improved

| Tag | Change |
|-----|--------|
| **Install** | One-command `.deb` package with full desktop integration — launcher, hicolor icons, app menu entry |
| **Branding** | New dolphin brand mark; every factory image removed from the project |
| **Appearance** | Five app icon color themes plus a custom RGB picker in *Settings → Appearance* |
| **Sync** | The chosen color flows to the desktop icon, window icon, favicon, welcome page and every in-app dolphin |
| **Persistence** | Your color choice is saved and restored across reboots until you change it |
| **Notify** | System notification and window flash when a task finishes while the app is minimized or unfocused |
| **Feedback** | Feedback opens directly on our X page — no vendor questionnaire, no external forms |
| **Accounts** | Official sign-in removed; version set to 0.1.0 |
| **Local-first** | Your models, your keys, your data stay on your device |

---

## Feedback

Tried it? Something broke? Something should be better?

**[Leave feedback on X →](https://x.com/ArthurFran666)**

Clicking Feedback inside the app takes you straight to the same page.

---

## Install

```bash
# from the GitHub Releases page, then:
sudo dpkg -i deepseek-harness_0.1.0_amd64.deb
```

- **Requirements:** Ubuntu/Debian-based distro, x86_64
- On first launch the app registers its launcher, icons and `.desktop` entry automatically.

---

## Source code

The full source tree ships in this repository:

```
linux-build/
├── build-deb.sh                  # builds the .deb (regenerates all icon sizes from resources/icon.png)
├── app/
│   └── resources/
│       ├── icon.png               # 1024×1024 source icon (dolphin on the gradient tile)
│       └── app/
│           ├── lib/
│           │   ├── main.js        # Electron main process: window, tray, icon theme IPC, notifications
│           │   └── preload-app.cjs
│           ├── renderer/          # welcome page, brand assets (welcome-brand.svg)
│           └── dsh/               # plugin packages (theme, sidebar, chat, settings, …)
└── deepseek-harness_0.1.0_amd64.deb
```

### Rebuilding

```bash
cd linux-build
bash build-deb.sh                 # → deepseek-harness_<version>_amd64.deb
sudo dpkg -i --force-downgrade deepseek-harness_0.1.0_amd64.deb
```

Key customization points:

- **Icon color themes** — `dsh-client-ui-theme/lib/client.js` (five presets + custom RGB, canvas-rendered at 1024px).
- **Desktop icon theming** — `lib/main.js`, `applyIconTheme()` / `restoreIconTheme()` (persists to `~/.dsh/icon-theme.json`, rewrites user hicolor icons and the `.desktop` entry).
- **Task-done notifications** — `lib/main.js`, `notifyDone` IPC → system notification + window flash.
- **Feedback / About** — `dsh-client-ui-settings-account/lib/client.js`.

---

## Credits

- Dolphin artwork based on [Twemoji](https://github.com/jdecked/twemoji) (CC BY 4.0).
- Community build. Not affiliated with or endorsed by DeepSeek.

## License

[MIT](LICENSE) © 2026 Arthur Fran666.

Third-party components keep their own licenses (Electron, Chromium, and the bundled dependencies — see `linux-build/app/LICENSE` and `linux-build/app/LICENSES.chromium.html`). The dolphin artwork remains under CC BY 4.0 as noted above.

## Maintainer

**[@ArthurFran666 on X](https://x.com/ArthurFran666)** — feedback and feature requests go there.
