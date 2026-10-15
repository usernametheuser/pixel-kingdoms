# Google Cloud deployment handoff

Target: a continuously running Compute Engine VM with durable local saves. This setup runs independently of the player's PC. It uses Docker restart policies, a persistent Docker volume on the VM disk, and Caddy for HTTPS and WebSocket forwarding.

**Status: prepared, not deployed.** No Google Cloud credentials or project are configured in this workspace. Current Google pricing pages could not be reached from this environment. Nothing here authorizes creating chargeable resources, upgrading billing, or claiming that the deployment is guaranteed free.

## Before provisioning

Open your own Google Cloud Console and select the intended project. Check these against your account's current quotas and pricing:

- Whether Compute Engine Free Tier is available and already being used in this billing account.
- The eligible VM type and regions. An `e2-micro` in a listed US Free Tier region is a candidate; do not assume another region or larger VM is free.
- Disk type and total disk allowance. Review a single standard persistent boot disk rather than adding unreviewed disks or using a different disk class.
- Public IPv4 address charges, outbound data charges, and any other resources. Multiplayer transfers data continuously while friends play.
- Whether trial credits are being used instead of an ongoing free allowance. Trial credits eventually expire.

Use the live Google pages and the account's cost estimate before selecting Create:

- [Google Cloud Free Tier](https://cloud.google.com/free/docs/free-cloud-features)
- [Network and IP pricing](https://cloud.google.com/vpc/network-pricing)
- [Google Cloud Console](https://console.cloud.google.com/)

If any required component incurs charges, stop and choose whether to change the architecture or approve a specific cost. The user's requested budget is zero. A budget alert is a notification, not a spending cap.

## Deployment once a suitable VM is approved

1. Use Ubuntu 24.04 on the reviewed VM. Keep the boot disk when deleting the VM if you need to retain its saved worlds. A Docker volume survives a container replacement, but deleting the underlying disk destroys it.
2. Permit inbound TCP 80 and 443 for the game. Keep SSH restricted to the intended administrative path, such as Google IAP or your own IP. Do not expose the internal game port 8080 separately.
3. Upload the prepared `pixel-kingdoms-cloud.zip` to your Google Cloud Shell or VM. It contains source/assets and deployment files; it excludes local credentials, saved-world tokens, runtime logs, node_modules, and tunneling executables.
4. Extract it into a retained directory, such as `/opt/pixel-kingdoms`. Set a public hostname resolving to the VM's reachable address. A hostname and the VM's actual reachable networking must be established before HTTPS can be verified.
5. From the project directory run:

   ```bash
   sudo bash deploy/bootstrap-ubuntu.sh YOUR_HOSTNAME
   ```

6. Inspect startup:

   ```bash
   sudo docker compose ps
   sudo docker compose logs --tail=100 game web
   ```

7. Open `https://YOUR_HOSTNAME`, create a private Duo/Squad/Penta room, and connect from two separate browsers/devices. Confirm snapshots, movement, and reconnects through HTTPS. Start with a Large map on a small VM and measure performance before increasing the map or room count.
8. Restart the game container, rejoin the same kingdom, and verify that the world persisted:

   ```bash
   sudo docker compose restart game
   ```

## Persistent worlds and backup

The `pixel-kingdoms-worlds` Docker volume mounts at `/data/saves`. Autosaves and graceful shutdown saves remain there across container rebuilds and VM reboots. The cloud configuration sets `SAVE_DAYS=0`, so older worlds do not expire automatically. Caddy's certificates have their own persistent volumes. Avoid `docker compose down -v`, which deletes volumes.

Run a manual consistent backup with:

```bash
sudo bash deploy/backup-worlds.sh
```

Keep a separate copy of important backups. Current local worlds have not been uploaded: their files contain kingdom reconnection tokens. Migrate them only into the confirmed private cloud destination, never a public source repository or website directory.

## AI on the cloud VM

The cloud setup does not assume a GPU or a local Ollama model. It enables the existing best-effort free provider and uses the game's offline fallback if that fails. It does not provision a paid AI key. Always-running model inference is not included in a small VM's game-server capacity estimate.

## Validation already performed locally

The server regression script passed malformed-input handling, Duo/Squad/Penta capacity and snapshots, graceful saving, and restart/rejoin. Docker and Google Cloud CLI are not installed in the current environment, so the Compose deployment and Ubuntu bootstrap have not been executed. The cloud instance, cost review, DNS, HTTPS, and internet multiplayer checks remain required before calling this deployed.
