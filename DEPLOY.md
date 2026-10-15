# Deploying Pixel Kingdoms (multiplayer)

The game is one Node.js server that serves the web page and the real-time WebSocket on a single port
(`PORT`, default `8080`). Every player just opens the URL in a browser. There is no install for players.

- **Rooms:** pick how many **real players** (1-10) and **AI kingdoms** (0-9), up to 10 kingdoms in total. The Duo, Squad, Penta and Solo presets fill these in for you.
  - **Public** rooms are listed for everyone online; **private** rooms can only be joined by code or invite link.
  - **⚡ Quick play online** drops you into the busiest public room with a free slot, or opens a new one.
- **Invites:** click **🔗 Copy invite link** in the game (top-right) and send it.
  Friends open `https://your-host/?join=ROOMCODE`, type a name and press Join.
- **Reconnecting:** after a dropped connection or a page refresh, the game reconnects you to **your own kingdom** automatically.
  The AI regent holds your kingdom for you for 30 minutes.
- **Saving (Continue):**
  - Every room is saved to disk every minute, and again when the server stops (Ctrl+C, `docker stop`, pm2 restart, host redeploy).
  - Rooms nobody is in are saved and go to sleep after 2 minutes. They wake up when someone continues or joins (about 0.2-1 s).
  - Each browser remembers the rooms you ruled, and the lobby shows **▶ Continue last room**, even after a server restart.
  - Saves are gzip-compressed JSON in `saves/` (roughly 150-500 KB per world) and are deleted after 30 days unused.
- `GET /healthz` returns `{ok, rooms, saved, online}` for uptime checks.
- Snapshots are compressed with permessage-deflate. I measured about 9 KB/s download per player (around 50 KB/s uncompressed), and more in big battles.

---

## 1. Same Wi-Fi / LAN (zero setup)
```bash
npm install
npm start
```
Find your PC's IP (`ipconfig` on Windows, for example `192.168.1.23`). Friends on the same network open `http://192.168.1.23:8080`.
If Windows asks, allow Node.js through the firewall (Private networks).

## 2. Play over the internet from your PC (free, about 1 minute)
Use a **Cloudflare quick tunnel**. It is free, needs no account, gives you HTTPS, and supports WebSockets:
```bash
npm start
```
```bash
cloudflared tunnel --url http://localhost:8080
```
It prints a URL like `https://random-words.trycloudflare.com`. Share that, or the in-game invite link.
Install cloudflared with `winget install Cloudflare.cloudflared` (Windows) or from https://github.com/cloudflare/cloudflared/releases.

`ngrok http 8080` works too (free account required).

Your PC keeps running Ollama, so everyone gets the local Qwen AI.

## 3. Free cloud hosting (always online)
Any host that runs a Node web service with WebSockets works. The repo includes a `Dockerfile`.

**Render.com**
1. Push this folder to a GitHub repo.
2. Render → New → Web Service → pick the repo.
3. Runtime **Node**, Build `npm install`, Start `npm start` (or choose Docker).
4. Leave `PORT` alone: Render sets it and the server reads it.

The free plan sleeps after inactivity, so the first visit takes about 30 s to wake up.
⚠️ Free Render instances have **no persistent disk**, so saved worlds are lost when the service redeploys or restarts.
On a paid plan, add a Disk mounted at `/data` and set `SAVE_DIR=/data/saves`.

**Railway / Fly.io / Koyeb**: deploy the repo with the Dockerfile. They auto-detect port 8080 (or set `PORT`).
```bash
fly launch --now
```
To keep saves across deploys, attach a volume at `/data/saves`. On Railway: Settings → Volumes. On Fly:
```bash
fly volumes create pk_saves --size 1
```
Then add `[mounts] source="pk_saves" destination="/data/saves"` to `fly.toml`.

AI on cloud hosts: there's no GPU or Ollama there, so the server automatically uses the free keyless online AI
(Pollinations) instead. You can set `ANTHROPIC_API_KEY` for Claude, or point `OLLAMA_URL` at an Ollama server you run elsewhere.

## 4. Your own VPS (best performance)
Ubuntu example, with Node 20+:
```bash
git clone <your repo> pixel-kingdoms
```
```bash
cd pixel-kingdoms && npm install && npm i -g pm2
```
```bash
pm2 start server/index.js --name pixel-kingdoms && pm2 save && pm2 startup
```
Put HTTPS in front with **Caddy**, which gets the certificate automatically and proxies WebSockets out of the box.
`/etc/caddy/Caddyfile`:
```
play.yourdomain.com {
    reverse_proxy localhost:8080
}
```
For local AI on the VPS:
```bash
curl -fsSL https://ollama.com/install.sh | sh
```
```bash
ollama pull qwen2.5:3b
```
The game detects it at `localhost:11434` automatically.

Or with Docker:
```bash
docker build -t pixel-kingdoms .
```
```bash
docker run -d -p 8080:8080 -v pk-saves:/data/saves --restart unless-stopped --name pk pixel-kingdoms
```
If Ollama runs on the host, add `-e OLLAMA_URL=http://host.docker.internal:11434`.

## Environment variables
| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket port |
| `OLLAMA_URL` | `http://localhost:11434` | Local free AI server |
| `OLLAMA_MODEL` | first Qwen model found | e.g. `qwen2.5:7b` |
| `LOCAL_AI` | on | `off` disables Ollama |
| `FREE_AI` | on | `off` disables Pollinations |
| `ANTHROPIC_API_KEY` | none | Use Claude (best AI) |
| `SAVE_DIR` | `./saves` (`/data/saves` in Docker) | Where saved worlds are kept |
| `SAVE_EVERY_S` | `60` | Autosave interval (seconds) for rooms with players |
| `SAVE_DAYS` | `30` | Delete saves unused for this many days; `0` keeps them indefinitely |

## Capacity
One room holds up to 10 kingdoms (any mix of real players and AI), plus hundreds of AI units.
- **Per room:** about 1.5-3 ms of CPU per tick (30 ticks/s) on a Mega map.
- **Per server:** a small 1 vCPU VPS comfortably runs several rooms at once.
- **Cleanup:** empty rooms are saved and unloaded after 2 minutes, so sleeping worlds cost no CPU.

## 24/7 online for free (Render + UptimeRobot)
1. Create a free GitHub account and a new repository. Click **uploading an existing file** and drag in everything from the `pixel-kingdoms-upload` folder (42 files). Then **Commit**.
2. On [render.com](https://render.com), sign in with GitHub, then **New → Blueprint** and pick the repo. Render reads `render.yaml` and deploys. Your game URL is `https://pixel-kingdoms-xxxx.onrender.com`.
3. On [uptimerobot.com](https://uptimerobot.com), add a free **HTTP monitor** for `https://<your-url>/healthz` every **5 minutes**.
   - Free Render services sleep after 15 minutes without visitors; the ping keeps yours awake around the clock.
   - The free plan's 750 hours a month covers one service running non-stop.

Notes:
- Free Render has no persistent disk, so saved rooms reset whenever Render redeploys or restarts the service. Add a paid disk and `SAVE_DIR` to keep them.
- AI works out of the box: the free online AI needs no key. Set `ANTHROPIC_API_KEY` in Render's Environment tab for Claude.