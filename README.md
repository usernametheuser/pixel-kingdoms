# Pixel Kingdoms

A real-time, multiplayer, pixel-art kingdom sandbox, remixed from the ideas in
[freeciv-web](https://github.com/freeciv/freeciv-web) (procedural world, rival civilizations,
medieval → modern units, browser play). It drops freeciv's turns, tech tree and city limits.
Instead it is an open world you roam freely, where every player rules a kingdom.

## Features
- **Rooms:** choose how many **real players** and how many **AI kingdoms**, up to 10 kingdoms in total. The **Duo / Squad / Penta / Solo** presets fill these in, or pick any mix. Share the 5-letter code.
  - AI regents rule empty player slots until a friend joins and takes one over with its whole army.
  - AI kingdoms always stay AI.
- **Online play:** **public** rooms appear in everyone's lobby with live player counts; **private** rooms are invite-only. **⚡ Quick play online** joins the busiest open room, or opens a new one.
- **Saved worlds (Continue):** rooms are saved on the server every minute and when it shuts down. The lobby shows **▶ Continue last room**, which brings you back to your own kingdom even after closing the browser or restarting the server. Idle rooms sleep on disk and wake when someone returns.
- **Huge open maps:** Large 512², Huge 768² (default), Giant 1024² or **Colossal 1536²** tiles of continents, islands, beaches, forests, hills, mountains and snow. Everything is unlocked from the start.
- **Prebuilt free towns:** 10-70 towns (by map size) with town halls, houses, markets, wells, farms, windmills, militia and civilians. **Capture** one by holding its town hall with your troops and no defenders nearby for 6 s. You can also found your own town by building a Town Hall.
- **Civilians:** villagers, townswomen, farmers and merchants live in houses (each house holds 2), wander around their town, flee from danger, and can be talked to.
- **Vehicles:** tank, humvee, prop fighter, **stealth fighter** (missiles), **attack helicopter** (minigun + missiles, spinning rotor), **heavy bomber** (carpet bombs), warship, speedboat and **horses**. Wild horses can be tamed with **E**.
- **Animals:** deer, rabbits and eagles flee; wolves, bears and sharks hunt. You can also raise animals as pets.
- **Aliens:** UFOs and alien troopers invade a kingdom every 5-8 minutes, and the waves grow over time. You can also recruit your own aliens.
- **Intelligent AI:**
  - Units pick targets sensibly (wounded enemies and threats first), kite with ranged weapons, retreat to heal when badly hurt, and defend their ruler.
  - Town militia rally to defend their town.
  - AI regents plan a strategy every few minutes (defend, expand, attack or capture towns) and announce it to all players.
- **AI Forge (F):** describe any **NPC, weapon, vehicle or building** and the AI designs its stats and a 16×16 pixel sprite. Forged buildings can shoot and train units.
- **AI NPC chat (T):** your soldiers and civilians talk in character, describe what's around them, and obey spoken orders.

## Graphics
A modern pixel-art renderer (`public/gfx.js`):
- **Terrain:** organic, wavy biome borders; 3D hill-shading from real elevation; water shaded by depth, with shoreline foam, wet sand and animated glints.
- **Nature:** trees, pines, palms, bushes and rocks are proper objects. Units walk behind them, and a tree fades when it hides you.
- **Buildings in 3/4 view:** walls, gable roofs and cone towers. Flags wave, windmills turn, chimneys and factories smoke, damaged buildings burn, and windows glow at night.
- **Characters:** automatically outlined and shaded sprites with walk-cycle animation, team rings, white hit-flash and floating damage numbers.
- **Day/night cycle (10 min):** dynamic lights from lanterns, torches, windows, headlights, UFOs, tracers and explosions, plus dawn and dusk colour grading.
- **Weather:** drifting cloud shadows and rain showers (every player sees the same weather).
- **Effects:**
  - Explosions with fireball, smoke, debris and sparks, plus screen shake and scorch marks.
  - Glowing bullet tracers and rocket smoke trails.
  - Jet contrails, boat wakes, vehicle dust and a spinning helicopter rotor.
- **Modern HUD:** glass panels, a weapon hotbar with icons, a clock and weather readout, and crisp screen-space labels.
- Tip: add `?tod=0.9` to the URL to preview night (0 = midnight, 0.5 = noon).

## Performance (smooth when zoomed far out)
- **Zoom:** from 0.25× (strategic view of a huge area) to 5×. The clock shows live **fps** and render resolution.
- **Background terrain:** map chunks, trees and rocks are rendered in **Web Worker threads**, so panning into unseen land never stutters. Each chunk has **3 detail levels (LOD)**: when zoomed out, cheaper chunks are drawn, and units become strategic dots.
- **Dynamic resolution upscaling:** the browser's stand-in for DLSS/FSR. Browsers have no real frame generation, so when a frame gets slow, the game renders at a lower internal resolution and upscales it. It returns to full sharpness when there's headroom.
- **Smooth motion:** server snapshots are interpolated (and your own movement is predicted), so motion stays smooth at any frame rate.
- **Night lighting:** the darkness mask and all coloured glows render into small buffers and are composited in one pass each. Hundreds of lights cost about the same as a few.
- **Debugging:** in the console, `__pk.prof = {}` records per-section frame timings into `__pk.prof`.

## Arsenal
- **Fighter jets:** F-16 Fighting Falcon, HAL Tejas, Dassault Rafale, Su-30MKI, F-22 Raptor, F-35 Lightning II, MiG-29, Eurofighter Typhoon, A-10 Warthog and a WW2 prop fighter. They carry a 20mm cannon plus air-to-air missiles on right-click.
- **Bombers and drones:** B-52, B-2 Spirit and the MQ-9 Reaper.
- **Helicopters:** AH-64 Apache, HAL Prachand, Mi-24 Hind and CH-47 Chinook (twin rotors).
- **Warships:**
  - Frigate, destroyer (cruise missiles), corvette and speedboat.
  - Battleship with triple 16-inch guns.
  - Submarine with torpedoes; it's stealthy and only spotted up close.
  - Aircraft carrier that launches its own jets.
- **Ground vehicles:** M1 Abrams, Arjun MBT, T-90, APC, howitzer, rocket launcher, humvee and horses. Tank turrets aim independently.
- **New buildings:** helipad, naval shipyard, SAM site, bunker, radar (spinning dish), hospital (fast healing), church and lighthouse (sweeping beam at night).
- **Mega map size:** 2048² tiles, with up to 120 free towns.
- More nature (stumps, logs, reeds, mushrooms, flower bushes, boulders, lily pads) and ambient life (bird and seagull flocks with shadows, butterflies, fireflies at night, jumping fish).

## AI: free, no key needed
The server tries these in order:
1. **Claude** (`claude-opus-5-5`), if `ANTHROPIC_API_KEY` is set. This gives the best sprites and dialogue.
2. **Local Qwen via [Ollama](https://ollama.com)**: free, no key, no rate limits. It is auto-detected at `localhost:11434` and prefers a Qwen model.
   Setup: install Ollama, then run `ollama pull qwen2.5:3b`. `qwen2.5:7b` writes better lines if your PC can run it; select it with `OLLAMA_MODEL=qwen2.5:7b`.
3. **Free keyless online AI**: [Pollinations](https://pollinations.ai) (`text.pollinations.ai/openai`, anonymous tier).
4. **Offline fallback**: keyword rules and procedural sprites, so the game never breaks.

What the AI drives:
- **Spoken orders:** NPCs reply in character when you press T. A keyword check makes sure orders like "everyone attack" are always obeyed.
- **Battle lines:** soldiers, pilots, sailors, tank crews, townsfolk, militia and aliens shout lines for battle, wounds, victory, fleeing, marching, town captures, invasions and night. These come from an AI-written bank that refreshes continuously.
- **Overheard conversations:** short AI-written exchanges between NPCs standing near players.
- **AI regents** plan strategy for computer-run kingdoms.
- **The Forge** designs anything you describe.

Notes on the free tier:
- Requests go out one at a time, and a reply takes about 10-40 s.
- Player prompts and NPC chat are sent to Pollinations, a third-party service.
- The free model's sprites are rougher than Claude's.
- Set `FREE_AI=off` to disable it. `FREE_AI_URL` and `FREE_AI_MODEL` point it at another OpenAI-compatible endpoint.

## Real-world maps
Pick a **World** in the lobby:
- **🎲 Random:** new procedural continents every time.
- **🗺️ India:** the real Indian subcontinent from Natural Earth coastlines (public domain).
  - Terrain: the Himalaya, Karakoram and Tibet, the Thar desert, the Western and Eastern Ghats, the Aravalli and Vindhya ranges.
  - Rivers (navigable): Ganga, Yamuna, Brahmaputra, Indus, Godavari, Krishna, Narmada, Kaveri and Mahanadi.
  - Kingdoms are historic realms at their real capitals: Indraprastha (Delhi), Magadha (Patna), Chola (Chennai), Maratha (Mumbai), Kamarupa (Guwahati) and more.
  - **80+ real cities** are towns to capture.
- **🌍 Earth:** the whole planet.
  - Terrain: real continents, the Andes, Rockies, Alps and Himalaya, the Sahara and outback, the Amazon and Congo, and great rivers.
  - Realms start at real capitals: Bharat, Nippon, Rus, Britannia, Aztlan and more.
  - 100+ world cities are towns.
  - Pick Colossal or Mega.

**Names:** choose **Indian** (Maurya, Chola, Rampur, Sitapur…) or **Fantasy** names for random worlds. Click your kingdom name, or use Joint HQ, to **rename** your kingdom and any town you rule.

## Indian cities & assets
- **Indian towns:**
  - Streets lined with colourful apartment blocks and shop rows (CHAI, DOSA, PAAN…), lamps, chai stalls, fruit carts, bus stops, hoardings and working traffic signals.
  - Temples (mandir, masjid, gurudwara, church), a water tower and police.
  - Big cities add glass high-rises, a mall, a hospital, a **railway station with trains arriving and departing**, a district **jail** with sweeping searchlights, the **Grand Mandir** and the Victory Arch.
- **Himalayan villages:** stone houses, a monastery and fluttering prayer flags.
- **Traffic:** auto-rickshaws, taxis, cars, buses, painted lorries, scooters, tractors and ambulances drive on the left, stop for people and traffic, and light up at night.
  - Press **E** to grab one.
  - Police jeeps and ambulances flash their light bars.
- **Indian arsenal:**
  - **Air:** **HAL AMCA** stealth fighter (IAF roundels, internal bays, hard to spot), Su-30MKI with **BrahMos-A**, Tapas UAV, HAL Dhruv.
  - **Ground:** K9 Vajra, Pinaka, BMP-2 Sarath, Army 4x4, supply trucks (heal nearby troops), **BrahMos mobile launcher**.
  - **Sea:** Kolkata-class destroyer, INS Vikrant.
  - **Infantry:** Para SF commandos, snipers, machine gunners and anti-tank gunners.
  - **Weapons:** INSAS, AK-203, sniper rifle, Negev LMG, Carl Gustaf, grenades.
  - **Buildings:** Lal Qila fort, Cantonment, Army Depot, **BrahMos Battery** (2.2 km range).
- **Panels:** Build and Army panels are sorted into category tabs with search. The **📚 Gallery** (lobby) shows every unit, building and weapon, animated, by day or night.

## Air combat: missiles & flares
- **Pylons:** jets show the missiles they carry (6 for fighters), and they disappear one by one as you fire. They reload slowly in flight and fully when you land. Stealth jets (AMCA) carry theirs inside.
- **Lock-on:** keep the cursor on an enemy. The diamond closes in with a seeking tone and turns red with a lock tone, then **RMB** fires.
  - Fighters automatically use **air-to-air** missiles against aircraft and **air-to-ground** missiles against tanks, ships and buildings.
  - Guided missiles lead their target (proportional navigation).
- **Flares (Space):** bright decoys that make many incoming missiles lose their lock and burst harmlessly. AI pilots pop flares too.
- **Effects:**
  - **In flight:** real missiles with exhaust plumes and lingering smoke trails, launch blasts, falling bombs with shadows, torpedo wakes.
  - **Engines:** an orange afterburner glow, or blue shock diamonds on full afterburner (Shift). Wingtip vapour when banking hard.
  - **Explosions:** shockwave rings, a fireball, a rising smoke plume and embers.
  - **Sky:** puffy clouds below you when zoomed out.

## Joint Military Command (J)
- **Alliances:** propose an alliance to any kingdom from **Joint HQ**.
  - AI regents decide for themselves. They accept against a common, stronger enemy or when they need friends, and refuse if your armies have hurt them or if the alliance would rule the world unopposed.
  - Human rulers get an Accept / Decline prompt.
  - Allies never shoot each other, splash damage spares them, they defend each other's towns, and allied hospitals heal your troops.
- **Joint operations:** **Joint Strike**, **Joint Defense**, **Capture Town** and **Air Patrol**. Pick the target on the map or minimap and choose how much of your army to commit (25-100%).
  - Forces from every allied kingdom gather at a **staging point** out of the enemy's reach, then attack together once 75% are in position.
  - **Combined arms:** armour leads, infantry follows, artillery fires from range, fighters fly patrols over the target, and ships bombard from the nearest water.
  - **Intel and risk:** every operation is rated low, medium or high risk (enemy strength vs your force) when you launch it.
  - **Adapting:** a strike that clears its target pushes on to nearby enemy buildings. If it meets heavy resistance it commits reserves, and if losses get too heavy it retreats.
  - **Coalition radio:** reports progress, commitments and calls for help.
  - **Your contribution:** set how much of your army joins operations your allies launch (default: none).
- **Map markers:** a crosshair marks each target and a dashed line runs from its staging point, on the map and the minimap.

## Smarter AI
- **The war council** (AI kingdoms) tracks:
  - who has hurt it, and how badly;
  - every army's strength and mix (air, armour, infantry, navy);
  - how well defended each possible target is.

  From this it:
  - **picks targets** by grudge, weakness and distance, and only attacks with enough force to win;
  - **defends its own land** at once, asking allies for help when outgunned;
  - **captures towns** with real squads;
  - **recruits counters** to the enemy's army (fighters and SAMs against air power, attack helicopters and artillery against armour);
  - **balances power**: AI kingdoms band together against anyone who grows too strong (including you), and invite human rulers to join them.
- **Units:**
  - **focus fire** to finish wounded targets;
  - **call nearby friends and allies** when attacked;
  - **retreat when badly outnumbered**, not only when nearly dead;
  - artillery fights from maximum range;
  - **no wasted shots**: swords and tank or artillery cannons don't try to hit aircraft.

## Vehicles, crews and flight
- **Physics:** every vehicle has momentum, acceleration, braking and a turn rate. Jets bank and can't hover; heavy bombers turn slowly; carriers turn very slowly. Clients interpolate snapshots (20/s), so motion is smooth.
- **Crews:** every vehicle has an AI pilot or driver. You can board any vehicle next to you: your own (the crew hops out and waits), or any **EMPTY** one, including an enemy's. Idle AI pilots walk to empty vehicles and take them back into service. Destroyed jets often eject their pilot.
- **Flight:**
  - Jets take off by rolling down an airport runway, land with **L** over a runway or carrier deck (airbrakes on), and taxi on the ground.
  - Helicopters take off and land anywhere with **L**.
  - AI jets scramble when enemies come near, dogfight with forward-firing guns and homing missiles, then fly back, line up and land at their airport.
- **Bases:** each kingdom starts with an **airport** (runway, hangars, terminal, control tower, parked jets) and a fenced **military base** (bunkers, SAM sites, radar, war factory, helipad, parked armour and crews). Abandoned airfields and depots are scattered around the map with empty vehicles to steal.

## Commanding your NPCs
- **Command mode** (**Q**, or hold **Ctrl**): click a unit or drag a box to select several. **Right-click** gives a context order:
  - on the ground: **move** there;
  - on an enemy: **attack** it;
  - on an **EMPTY vehicle**: **board** it.
- **Unit card** (bottom-right): Talk, Follow me, Hold, Move, Attack, Board vehicle, Get out (**G**), Take off and Land (**L**).
- **Who can operate what:** **Pilots** fly any aircraft and drive anything; soldiers drive tanks, trucks and boats. Raise Pilots from the Army panel. Each base also has a few, and crews who step out of a vehicle become Pilots too.
- **Talking:** **T** talks to the selected NPC (any unit you pick, not just the nearest). NPCs **remember the conversation** and understand orders like "take the helicopter and attack", "fly the F-16", "land and get out", "take off" or "everyone follow me".
- **Landing:**
  - Aircraft fly a real approach: out to the final-approach fix, intercept the runway centerline, flare over the threshold, roll out with brakes, then taxi to parking. They pick whichever runway end they're closer to (09 or 27).
  - Helicopters prefer free helipads.
  - In a jet, **L** engages an **autopilot landing** at the nearest runway or carrier; steer to take back control. Dashed runway guide lines appear while you're flying a jet.
- **Getting out:** you and NPC crews step out at a safe spot beside the vehicle; you can't climb out of a ship at sea. A vehicle you order your crew out of stays parked for a minute.

## Multiplayer and deployment
- **Invite friends:** create a room, then use **🔗 Copy invite link** (top-right). Friends open the link, enter a name and join.
- **Reconnecting:** dropped connections reconnect you to your own kingdom automatically. Your kingdom is held for 30 minutes, and your saved token brings you back to it later.
- **Hosting:** see **[DEPLOY.md](DEPLOY.md)**. It covers LAN, a free Cloudflare tunnel from your PC, Render/Railway/Fly.io, and a VPS with pm2 and Caddy. A Dockerfile is included.

## Run it
```bash
npm install
npm start
```
Open http://localhost:8080. Friends on your network open `http://<your-ip>:8080`.
For internet play, port-forward 8080 or use a tunnel (`cloudflared`, `ngrok`).

## Controls
| Key | Action |
|---|---|
| WASD / arrows, Shift | Move, sprint |
| Mouse / LMB | Aim / fire |
| RMB | Missiles or bombs (aircraft) |
| 1-9, Shift+wheel | Switch weapon |
| Wheel | Zoom |
| E | Enter / exit / tame a vehicle or horse |
| Z / X / C / V | Army: follow / guard / attack cursor / at ease (hold Alt for nearby units only) |
| T | Talk to your unit nearest the cursor |
| B / U / F / H | Build, raise units, AI Forge, help |
| J | Joint HQ: alliances and joint operations |
| E (next to traffic) | Grab a car, auto, bus or scooter |
| Shift+click minimap | Send army there |
| Enter | Chat |
| M | Music |

## Layout
- `server/index.js`: HTTP static server, WebSocket lobby and rooms (autosave, sleep and wake, quick play)
- `server/store.js`: room saves on disk (`saves/`, gzip JSON, atomic writes)
- `server/game.js`: 30 Hz simulation (combat, unit AI, towns and capture, wildlife, aliens, AI regents)
- `server/command.js`: Joint Military Command (coalitions, joint operations, war-council AI)
- `server/ai.js`: AI providers (Claude → Pollinations → offline), Forge, NPC chat, regent planning
- `public/shared/`: deterministic map generator and game definitions shared by server and client
- `public/shared/geo.js` + `geo/*.json`: real-world maps (Natural Earth coastlines, ranges, deserts, rivers, cities); rebuild the data with `node tools/build-geo.mjs`
- `public/gallery.html`: the asset gallery
- `public/client.js`: canvas pixel renderer, HUD and input

Music by Andrew Beck and others, taken from the freeciv-web repository (see the freeciv-web licenses).
