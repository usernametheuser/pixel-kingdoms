# Play with friends

For the requested Google Cloud hosting that stays online when the PC is off, see [deploy/GOOGLE_CLOUD.md](deploy/GOOGLE_CLOUD.md). The Windows launchers below are optional PC hosting only.

The game runs on this PC. Public hosting uses a temporary Cloudflare HTTPS tunnel. Your PC must remain awake, online, and running the game and tunnel. No game installation is needed for friends.

1. Double-click **Start-Multiplayer.cmd** in this folder.
2. Wait for **PLAY / SHARE** and the public address. The launcher checks the public health endpoint before printing a new address.
3. Open that address. Create a **Private** room and choose **Duo** (2), **Squad** (4), or **Penta** (5).
4. Click **Invite** in the game and share the resulting room link. Friends enter their names and join.

The room you were playing during setup has code **4XW79**, with five player slots. Once a tunnel is connected, friends can join it at `<public address>/?join=4XW79`. You can keep playing from `http://localhost:8080` while they use the public address.

Double-click **Stop-Multiplayer.cmd** to save worlds and stop this setup. Stopping or recreating a Quick Tunnel changes its public address. Saved games stay in `saves/`; keep that folder when moving the project. A backup made during setup is in `runtime/backups/`.

## Connection troubleshooting

- Logs: `runtime/game.out.log`, `runtime/game.err.log`, `runtime/tunnel.err.log`.
- The most recent verified public address is stored in `runtime/public-url.txt`.
- The default tunnel transport is QUIC. If UDP is unavailable, run `powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-Multiplayer.ps1 -Transport http2`.
- During setup, Norton HTTPS scanning replaced Cloudflare's tunnel certificate with one issued by **Norton Web/Mail Shield Untrusted Root**. That certificate is deliberately untrusted; the launcher does not trust it or disable verification. QUIC avoids that TLS inspection path if the network permits UDP.
- Network attempts from command-line apps also began failing DNS resolution and timing out, although the game loaded in the browser. If that continues, check Norton's app/network controls for the bundled `tools/cloudflared.exe` and your installed `node.exe`, and inspect the DNS/network connection. Keep antivirus and certificate verification enabled.

Quick Tunnels are temporary and have no uptime guarantee. For a permanent address or hosting that remains online when this PC is off, use a persistent Node.js host and a volume for `saves/`. [Cloudflare Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Changes made for hosting

- Malformed URLs return HTTP 400; non-object WebSocket messages are ignored.
- Socket errors and lobby failures are handled instead of terminating every room.
- Failed idle-world saves leave the world in memory for another attempt.
- Local Stop saves worlds before exiting.
- The background launcher uses independent file handles and hidden detached processes.
- Run `npm test` for crash, multiplayer capacity, save, and reconnect regression checks.
