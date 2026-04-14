# tabbb

**Keep tabs on your tabs.**

tabbb replaces your Chrome new tab page with a dashboard that shows everything you have open -- grouped by domain, with landing pages (Gmail, X, LinkedIn, etc.) pulled into their own group for easy cleanup. Close tabs with a satisfying swoosh + confetti.

Built for people who open too many tabs and never close them.

Based on [tab-out](https://github.com/zarazhangrui/tab-out) By [zara](https://x.com/zarazhangrui). Thanks Zara!

---

## Features

- **See all your tabs at a glance** -- grouped by domain on a clean grid, no more squinting at 30 tiny tab titles
- **Landing pages group** -- homepages and feeds (Gmail, X, LinkedIn, GitHub, YouTube) are pulled into one card so you can close them all at once
- **Close tabs with style** -- swoosh sound + confetti burst when you clean up a group. Makes tab hygiene feel rewarding
- **Duplicate detection** -- flags when you have the same page open twice, with one-click cleanup
- **Click any tab to jump to it** -- switches to the existing tab, even across windows
- **Save for later** -- bookmark individual tabs to a checklist before closing them
- **100% local** -- your browsing data never leaves your machine. No AI, no external API calls, no background server.
- **Always on** -- runs entirely inside Chrome.

---

## Setup

**1. Clone the repo**

```bash
git clone https://github.com/hardik88t/tabbb.git
cd tabbb
```

**2. Load the Chrome extension**

1. Go to `chrome://extensions` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repo

Open a new tab -- you'll see tabbb.

---

## Tech stack

| What | How |
|------|-----|
| UI | HTML/CSS/JS (Vanilla) |
| Storage | Chrome Storage API (local) |
| Extension | Chrome Manifest V3 |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti particles |

---

## License

MIT

---

Built by [hardik88t](https://x.com/hardik88t)
