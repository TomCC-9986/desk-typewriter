# Desk Typewriter 桌面打字机

[中文](README.md) | **English**

A little vintage typewriter that lives in the corner of your screen. Type a note, send it, and it prints line by line from the top of your friend's screen.

For Mac and Windows, free to download: **https://typewriter.tomcc.workers.dev/?lang=en**

![Desk Typewriter](download/assets/hero.webp)

## What it does

- Every key really goes down, with mechanical sounds; hit return and the sheet is sent
- Notes you receive print down from the top of your screen
- Friends nearby get notes directly over Bluetooth or the local network; friends far away get them through a relay server
- Swap the typing sound: typewriter, piano notes, water drops, wind chime, marimba, rain, leaves, campfire

## What's in the repo

| Folder | What it is |
|---|---|
| `app/` | The desktop app (Electron + three.js): the typewriter model, note windows and sounds |
| `server/` | The relay for sending notes over the internet (Cloudflare Worker + Durable Object) |
| `download/` | The download page (Cloudflare Worker, Chinese and English, with a playable 3D typewriter) |
| `shared/` | Protocol types shared by the app and the server |
| `docs/` | Design doc and development plan (in Chinese) |

## Run it yourself

Requires Node.js 20 or later.

```sh
# Desktop app
cd app && npm install
npm start               # run in development
npm run dist:mac        # build the Mac installers
npm run dist:win        # build the Windows installer

# Relay server (only needed for sending notes over the internet)
cd server && npm install
npx wrangler deploy     # deploy to your own Cloudflare account, then put its URL in the app's 服务器 (Server) setting

# Download page
cd download
node prepare.mjs        # split the installers in ../安装包/ (the installers folder) into parts
node build-web.mjs      # bundle the 3D typewriter for the page
npx wrangler deploy
```

The KV namespace id in `server/wrangler.toml` belongs to the original author's account; replace it with one you create before deploying.

## Creators

1. **籽菜** ([@zizic04](https://github.com/zizic04))
2. **Claude** ([Anthropic](https://www.anthropic.com))
3. **TomCC 汤姆CC** ([@TomCC-9986](https://github.com/TomCC-9986))

## License

[MIT License](LICENSE): free to use, modify and distribute, including commercially, as long as the copyright notice is kept.

The fonts on the download page (Noto Serif SC, EB Garamond, IBM Plex Mono) are under the SIL Open Font License 1.1; their licenses are in `download/assets/fonts/`.
