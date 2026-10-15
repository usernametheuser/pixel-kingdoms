// Built-in content. Custom (AI-forged) weapons / NPCs / vehicles / buildings use the same shapes
// and are added to a room's catalog at runtime.

export const MODES = {
  duo: { label: 'Duo', players: 2 },
  squad: { label: 'Squad', players: 4 },
  penta: { label: 'Penta', players: 5 },
};

export const MAP_SIZES = { large: 512, huge: 768, giant: 1024, colossal: 1536, mega: 2048 };

export const KINGDOM_COLORS = ['#e04848', '#3f7fe0', '#e0b030', '#40b060', '#b050d0', '#e07a30', '#30c0c0', '#d0d0d0', '#ff70b0', '#9a6a40'];

// Non-player factions (negative kingdom ids)
export const WILD = -1;
export const ALIEN = -2;
export const NEUTRAL = -3;
export const FACTIONS = {
  [WILD]: { name: 'Wildlife', color: '#a07040' },
  [ALIEN]: { name: 'Alien Swarm', color: '#60ff60' },
  [NEUTRAL]: { name: 'Free Towns', color: '#d8c890' },
};

// rate = ms between shots, speed = projectile px/s (0 for melee), splash = explosion radius
export const WEAPONS = {
  sword: { name: 'Sword', dmg: 24, rate: 420, speed: 0, range: 30, melee: true, color: '#e8e8e8' },
  spear: { name: 'Spear', dmg: 20, rate: 520, speed: 0, range: 40, melee: true, color: '#d8c8a0' },
  fists: { name: 'Fists', dmg: 4, rate: 700, speed: 0, range: 22, melee: true, color: '#f1c27d', hidden: true },
  bite: { name: 'Bite', dmg: 14, rate: 600, speed: 0, range: 24, melee: true, color: '#ffffff', hidden: true },
  claw: { name: 'Claws', dmg: 34, rate: 800, speed: 0, range: 30, melee: true, color: '#ffffff', hidden: true },
  bow: { name: 'Bow', dmg: 14, rate: 650, speed: 430, range: 380, color: '#c8a060', size: 2 },
  rifle: { name: 'Rifle', dmg: 9, rate: 140, speed: 720, range: 520, spread: 0.05, color: '#ffe066', size: 2 },
  shotgun: { name: 'Shotgun', dmg: 7, rate: 750, speed: 600, range: 260, count: 7, spread: 0.3, color: '#ffd080', size: 2 },
  rocket: { name: 'Rocket Launcher', dmg: 48, rate: 1300, speed: 380, range: 620, splash: 52, color: '#ff7a2a', size: 3, mk: 5 },
  cannon: { name: 'Tank Cannon', dmg: 60, rate: 1100, speed: 460, range: 560, splash: 42, color: '#ffb050', size: 4 },
  mg: { name: 'Machine Guns', dmg: 7, rate: 80, speed: 850, range: 520, spread: 0.07, color: '#fff2a0', size: 2 },
  minigun: { name: 'Minigun', dmg: 6, rate: 55, speed: 900, range: 480, spread: 0.09, color: '#fff2a0', size: 2 },
  missile: { name: 'Missiles', dmg: 80, rate: 900, speed: 650, range: 760, splash: 40, color: '#ff5050', size: 3, homing: 2.6, mk: 2 },
  bomb: { name: 'Bombs', dmg: 90, rate: 1500, speed: 160, range: 160, splash: 70, color: '#ff5030', size: 4, mk: 4 },
  carpet: { name: 'Carpet Bombs', dmg: 80, rate: 1600, speed: 150, range: 170, splash: 64, count: 4, spread: 0.5, color: '#ff5030', size: 4, mk: 4 },
  shipgun: { name: 'Naval Gun', dmg: 50, rate: 900, speed: 430, range: 680, splash: 40, color: '#ffa040', size: 4 },
  towerbow: { name: 'Tower Archers', dmg: 16, rate: 700, speed: 450, range: 420, color: '#c8a060', size: 2 },
  laser: { name: 'Ray Gun', dmg: 16, rate: 380, speed: 900, range: 480, color: '#60ff60', size: 2 },
  ufoBeam: { name: 'Death Ray', dmg: 45, rate: 900, speed: 1000, range: 520, splash: 30, color: '#a0ff60', size: 3 },
  cannon20: { name: '20mm Cannon', dmg: 8, rate: 60, speed: 950, range: 560, spread: 0.05, color: '#fff2a0', size: 2 },
  aam: { name: 'Air-to-Air Missiles', dmg: 95, rate: 1100, speed: 1000, range: 1400, splash: 34, color: '#ff4040', size: 3, homing: 4.2, mk: 1 },
  agm: { name: 'Air-to-Ground Missiles', dmg: 140, rate: 1300, speed: 560, range: 950, splash: 54, color: '#ffb040', size: 3, homing: 2.2, mk: 2 },
  gau8: { name: 'GAU-8 Avenger', dmg: 14, rate: 45, speed: 900, range: 520, spread: 0.08, color: '#ffd060', size: 2 },
  hellfire: { name: 'Hellfire Missiles', dmg: 110, rate: 1400, speed: 600, range: 820, splash: 44, color: '#ff6a2a', size: 3, homing: 2.4, mk: 2 },
  cruise: { name: 'Cruise Missiles', dmg: 140, rate: 2600, speed: 520, range: 1200, splash: 60, color: '#ff5030', size: 4, homing: 1.4, mk: 3 },
  naval: { name: '16-inch Guns', dmg: 130, rate: 2200, speed: 480, range: 980, splash: 70, count: 3, spread: 0.08, color: '#ffb050', size: 4 },
  ciws: { name: 'CIWS', dmg: 6, rate: 40, speed: 1000, range: 460, spread: 0.06, color: '#fff2a0', size: 2 },
  torpedo: { name: 'Torpedoes', dmg: 160, rate: 2400, speed: 300, range: 760, splash: 40, color: '#a0d8ff', size: 3, mk: 6 },
  howitzer: { name: 'Howitzer', dmg: 95, rate: 2800, speed: 420, range: 1000, splash: 58, color: '#ffa040', size: 4 },
  mlrs: { name: 'Rocket Barrage', dmg: 42, rate: 4200, speed: 460, range: 950, splash: 38, count: 6, spread: 0.22, color: '#ff7a2a', size: 3, mk: 5 },
  autocannon: { name: 'Autocannon', dmg: 13, rate: 160, speed: 820, range: 540, spread: 0.05, color: '#ffe066', size: 2 },
  sam: { name: 'SAM Missiles', dmg: 120, rate: 1800, speed: 950, range: 1300, splash: 40, color: '#ff4040', size: 3, homing: 4, antiAir: true, mk: 7 },
  bunkermg: { name: 'Bunker MG', dmg: 9, rate: 110, speed: 800, range: 520, spread: 0.06, color: '#fff2a0', size: 2 },
  pistol: { name: 'Sidearm', dmg: 7, rate: 450, speed: 650, range: 320, color: '#ffe066', size: 2 },
  // Indian arsenal
  insas: { name: 'INSAS Rifle', dmg: 10, rate: 150, speed: 760, range: 540, spread: 0.05, color: '#ffe066', size: 2 },
  ak203: { name: 'AK-203', dmg: 11, rate: 120, speed: 780, range: 520, spread: 0.06, color: '#ffe066', size: 2 },
  sniper: { name: 'Sniper Rifle', dmg: 75, rate: 1700, speed: 1500, range: 950, color: '#fff6c0', size: 2 },
  lmg: { name: 'Negev LMG', dmg: 8, rate: 75, speed: 800, range: 560, spread: 0.09, color: '#fff2a0', size: 2 },
  gustaf: { name: 'Carl Gustaf', dmg: 70, rate: 1800, speed: 420, range: 680, splash: 50, color: '#ff8a3a', size: 3, mk: 5 },
  grenade: { name: 'Grenades', dmg: 60, rate: 1400, speed: 260, range: 260, splash: 56, color: '#9acd32', size: 3 },
  lathi: { name: 'Lathi', dmg: 12, rate: 500, speed: 0, range: 34, melee: true, color: '#c8a060' },
  astra: { name: 'Astra BVR Missiles', dmg: 110, rate: 1000, speed: 1050, range: 1650, splash: 36, color: '#ff4040', size: 3, homing: 4.4, mk: 1 },
  brahmos: { name: 'BrahMos Cruise Missile', dmg: 320, rate: 9000, speed: 700, range: 2200, splash: 95, color: '#ff7020', size: 5, homing: 1.3, mk: 3 },
};

// Procedural art specs for modern vehicles (drawn by public/gfx.js, facing east).
// jet:  len (px), body (fuselage width), span, wing type, tail type, canards, engines, paint
// heli: len, body, rotor radius, twin rotors, stub wings
// ship: len, beam, deck style, turrets
// tank: len, wid, turret size, barrel length, style
const JET = (o) => ({ t: 'jet', engines: 1, tail: 'single', canard: false, paint: '#8d969f', ...o });

export const PLAYER_WEAPONS = ['sword', 'bow', 'insas', 'ak203', 'shotgun', 'sniper', 'lmg', 'gustaf', 'grenade'];

// domain: foot = walks/swims shallow, land = ground vehicle, water = boats, air = flies over everything
// group drives the Army panel; passive units never start fights; flee = run from danger; civ = civilian
export const UNITS = {
  knight: { name: 'Knight', group: 'Soldiers', kind: 'npc', domain: 'foot', hp: 130, speed: 82, weapon: 'sword', sprite: 'knight', r: 6, personality: 'honourable, brave, a little old-fashioned' },
  archer: { name: 'Archer', group: 'Soldiers', kind: 'npc', domain: 'foot', hp: 80, speed: 80, weapon: 'bow', sprite: 'archer', r: 6, personality: 'sharp-eyed, dry humour, patient' },
  rifleman: { name: 'Rifleman', group: 'Soldiers', kind: 'npc', domain: 'foot', hp: 95, speed: 88, weapon: 'rifle', sprite: 'soldier', r: 6, personality: 'disciplined modern soldier, short answers' },
  pilot: { name: 'Pilot / Crew', group: 'Soldiers', kind: 'npc', domain: 'foot', hp: 70, speed: 95, weapon: 'pistol', sprite: 'pilot', crew: true, r: 6, personality: 'a cocky but loyal vehicle crewman who wants to get back in the cockpit' },
  jawan: { name: 'Jawan (INSAS)', group: 'Soldiers', kind: 'npc', domain: 'foot', hp: 105, speed: 88, weapon: 'insas', sprite: 'jawan', r: 6, personality: 'a disciplined Indian Army jawan, says "Jai Hind", brave and steady' },
  commando: { name: 'Para SF Commando', group: 'Special forces', kind: 'npc', domain: 'foot', hp: 150, speed: 100, weapon: 'ak203', sprite: 'commando', r: 6, personality: 'an elite Para Special Forces commando in a maroon beret, calm, few words' },
  sniper: { name: 'Sniper', group: 'Special forces', kind: 'npc', domain: 'foot', hp: 85, speed: 84, weapon: 'sniper', sprite: 'sniper', r: 6, personality: 'a patient sniper in a ghillie suit who whispers' },
  rpgman: { name: 'Anti-tank Gunner', group: 'Special forces', kind: 'npc', domain: 'foot', hp: 100, speed: 82, weapon: 'gustaf', sprite: 'jawan', r: 6, personality: 'a tank-hunting gunner who loves his Carl Gustaf' },
  gunner: { name: 'Machine Gunner', group: 'Special forces', kind: 'npc', domain: 'foot', hp: 120, speed: 78, weapon: 'lmg', sprite: 'jawan', r: 6, personality: 'a heavy machine gunner, loud and cheerful' },
  police: { name: 'Police Constable', group: 'Police', kind: 'npc', domain: 'foot', hp: 90, speed: 86, weapon: 'lathi', sprite: 'police', r: 6, personality: 'a cheerful Indian police constable who keeps order with a lathi' },
  guard: { name: 'Jail Guard', group: 'Police', kind: 'npc', domain: 'foot', hp: 110, speed: 84, weapon: 'insas', sprite: 'police', r: 6, personality: 'a strict jail guard, suspicious of everyone' },
  militia: { name: 'Militia', group: 'Soldiers', kind: 'npc', domain: 'foot', hp: 100, speed: 80, weapon: 'spear', sprite: 'militia', r: 6, personality: 'proud town guard, protective of the townsfolk' },

  tank: { name: 'M1 Abrams', group: 'Ground vehicles', kind: 'vehicle', domain: 'land', hp: 760, speed: 74, weapon: 'cannon', sprite: 'tank', art: { t: 'tank', len: 24, wid: 15, turret: 9, barrel: 13, paint: '#a89a72' }, r: 11, personality: 'gruff tank commander' },
  arjun: { name: 'Arjun MBT', group: 'Ground vehicles', kind: 'vehicle', domain: 'land', hp: 820, speed: 68, weapon: 'cannon', sprite: 'tank', art: { t: 'tank', len: 25, wid: 15, turret: 10, barrel: 14, paint: '#7d8a4e' }, r: 11, personality: 'proud Indian tank commander, calm and precise' },
  t90: { name: 'T-90 Bhishma', group: 'Ground vehicles', kind: 'vehicle', domain: 'land', hp: 720, speed: 76, weapon: 'cannon', sprite: 'tank', art: { t: 'tank', len: 23, wid: 15, turret: 9, barrel: 14, round: true, paint: '#6f7a54' }, r: 11, personality: 'stoic veteran tanker' },
  apc: { name: 'APC', group: 'Ground vehicles', kind: 'vehicle', domain: 'land', hp: 480, speed: 120, weapon: 'autocannon', sprite: 'tank', art: { t: 'tank', len: 22, wid: 13, turret: 6, barrel: 9, wheels: true, paint: '#7a8070' }, r: 10, personality: 'chatty APC driver' },
  artillery: { name: 'Howitzer', group: 'Ground vehicles', kind: 'vehicle', domain: 'land', hp: 420, speed: 55, weapon: 'howitzer', sprite: 'tank', art: { t: 'tank', len: 22, wid: 14, turret: 8, barrel: 20, paint: '#8a8a6a' }, r: 10, personality: 'methodical artillery sergeant' },
  mlrs: { name: 'Rocket Launcher', group: 'Ground vehicles', kind: 'vehicle', domain: 'land', hp: 400, speed: 80, weapon: 'mlrs', sprite: 'tank', art: { t: 'tank', len: 24, wid: 13, turret: 9, barrel: 0, box: true, wheels: true, paint: '#6f7552' }, r: 10, personality: 'loud rocket crew chief' },
  bmp2: { name: 'BMP-2 Sarath', group: 'Ground vehicles', kind: 'vehicle', domain: 'land', hp: 520, speed: 105, weapon: 'autocannon', sprite: 'tank', art: { t: 'tank', len: 22, wid: 13, turret: 6, barrel: 10, paint: '#66764a' }, r: 10, personality: 'an IFV commander who never leaves his infantry behind' },
  gypsy: { name: 'Army 4x4 Patrol', group: 'Ground vehicles', kind: 'vehicle', domain: 'land', hp: 300, speed: 160, weapon: 'mg', sprite: 'humvee', art: { t: 'car', style: 'jeep', len: 16, wid: 9, body: '#5d6a40' }, r: 8, personality: 'a dusty army patrol driver who knows every road' },
  armytruck: { name: 'Army Supply Truck', group: 'Ground vehicles', kind: 'vehicle', domain: 'land', hp: 420, speed: 110, weapon: null, passive: true, supply: true, sprite: 'humvee', art: { t: 'truck', len: 28, wid: 11, cargo: 'canvas', paint: '#56633c' }, r: 11, personality: 'a supply truck driver; nearby troops heal and rearm around the truck' },
  k9: { name: 'K9 Vajra SPH', group: 'Artillery & missiles', kind: 'vehicle', domain: 'land', hp: 560, speed: 60, weapon: 'howitzer', sprite: 'tank', art: { t: 'tank', len: 25, wid: 15, turret: 10, barrel: 22, paint: '#a8946a' }, r: 11, personality: 'a self-propelled gun commander who loves long-range accuracy' },
  pinaka: { name: 'Pinaka MBRL', group: 'Artillery & missiles', kind: 'vehicle', domain: 'land', hp: 420, speed: 85, weapon: 'mlrs', sprite: 'tank', art: { t: 'tank', len: 25, wid: 13, turret: 10, barrel: 0, box: true, wheels: true, paint: '#6a7448' }, r: 10, personality: 'a rocket regiment chief, counts down every salvo' },
  brahmosl: { name: 'BrahMos Launcher', group: 'Artillery & missiles', kind: 'vehicle', domain: 'land', hp: 520, speed: 70, weapon: 'brahmos', sprite: 'tank', art: { t: 'truck', len: 34, wid: 11, cargo: 'missile', paint: '#5e6a3e' }, r: 13, personality: 'a precise missile battery commander; every launch gets a countdown' },
  humvee: { name: 'Humvee', group: 'Ground vehicles', kind: 'vehicle', domain: 'land', hp: 360, speed: 150, weapon: 'mg', sprite: 'humvee', r: 8, personality: 'fast-talking scout driver' },
  horse: { name: 'Horse', group: 'Ground vehicles', kind: 'vehicle', domain: 'land', hp: 200, speed: 175, weapon: null, mount: true, passive: true, sprite: 'horse', r: 7, personality: 'a spirited horse who answers in neighs and snorts' },

  jet: { name: 'Prop Fighter', group: 'Fighter jets', kind: 'vehicle', domain: 'air', hp: 260, speed: 270, weapon: 'mg', alt: 'bomb', sprite: 'jet', art: { t: 'prop', len: 20, span: 24, paint: '#7d8a5a' }, r: 10, personality: 'cocky WW2-style ace pilot' },
  fighter: { role: 'fighter', name: 'F-35 Lightning II', group: 'Fighter jets', kind: 'vehicle', domain: 'air', hp: 360, speed: 410, weapon: 'cannon20', alt: 'aam', alt2: 'agm', sprite: 'fighter', art: JET({ len: 30, body: 6, span: 20, wing: 'diamond', tail: 'twin', paint: '#7b828a' }), r: 12, personality: 'cool stealth pilot, callsign Ghost' },
  f16: { role: 'fighter', name: 'F-16 Fighting Falcon', group: 'Fighter jets', kind: 'vehicle', domain: 'air', hp: 340, speed: 430, weapon: 'cannon20', alt: 'aam', alt2: 'agm', sprite: 'fighter', art: JET({ len: 30, body: 4, span: 20, wing: 'cropdelta', paint: '#9aa4ae', bubble: true }), r: 12, personality: 'confident Viper pilot, loves dogfights' },
  tejas: { role: 'fighter', name: 'HAL Tejas', group: 'Fighter jets', kind: 'vehicle', domain: 'air', hp: 330, speed: 425, weapon: 'cannon20', alt: 'aam', alt2: 'agm', sprite: 'fighter', art: JET({ len: 28, body: 4, span: 18, wing: 'delta', tail: 'single', paint: '#a7b0b6', noTailplane: true, iaf: true }), r: 11, personality: 'proud Indian Air Force pilot, precise and calm' },
  rafale: { role: 'fighter', name: 'Dassault Rafale', group: 'Fighter jets', kind: 'vehicle', domain: 'air', hp: 380, speed: 420, weapon: 'cannon20', alt: 'aam', alt2: 'agm', sprite: 'fighter', art: JET({ len: 31, body: 5, span: 19, wing: 'delta', canard: true, engines: 2, paint: '#8c949c', noTailplane: true }), r: 12, personality: 'elegant French-trained pilot' },
  su30: { role: 'fighter', name: 'Su-30MKI Flanker', group: 'Fighter jets', kind: 'vehicle', domain: 'air', hp: 480, speed: 400, weapon: 'cannon20', alt: 'brahmos', alt2: 'agm', sprite: 'fighter', art: JET({ len: 36, body: 6, span: 24, wing: 'swept', tail: 'twin', canard: true, engines: 2, paint: '#8fa2b8', camo: '#6d8098', iaf: true }), r: 14, personality: 'heavy-fighter pilot with a booming laugh' },
  f22: { role: 'fighter', name: 'F-22 Raptor', group: 'Fighter jets', kind: 'vehicle', domain: 'air', hp: 420, speed: 450, weapon: 'cannon20', alt: 'aam', alt2: 'agm', sprite: 'fighter', art: JET({ len: 33, body: 6, span: 22, wing: 'diamond', tail: 'twin', engines: 2, paint: '#757d86' }), r: 13, personality: 'elite air-dominance pilot, few words' },
  mig29: { role: 'fighter', name: 'MiG-29 Fulcrum', group: 'Fighter jets', kind: 'vehicle', domain: 'air', hp: 360, speed: 415, weapon: 'cannon20', alt: 'aam', alt2: 'agm', sprite: 'fighter', art: JET({ len: 30, body: 5, span: 20, wing: 'swept', tail: 'twin', engines: 2, paint: '#9aa6a0', camo: '#7c8a80' }), r: 12, personality: 'old-school fighter jock' },
  typhoon: { role: 'fighter', name: 'Eurofighter Typhoon', group: 'Fighter jets', kind: 'vehicle', domain: 'air', hp: 370, speed: 435, weapon: 'cannon20', alt: 'aam', alt2: 'agm', sprite: 'fighter', art: JET({ len: 31, body: 5, span: 19, wing: 'delta', canard: true, engines: 2, paint: '#8e979f', noTailplane: true }), r: 12, personality: 'polished European fighter pilot' },
  amca: { role: 'fighter', name: 'HAL AMCA', group: 'Fighter jets', kind: 'vehicle', domain: 'air', hp: 440, speed: 455, weapon: 'cannon20', alt: 'astra', alt2: 'agm', stealth: 450, sprite: 'fighter', art: JET({ len: 34, body: 6, span: 22, wing: 'diamond', tail: 'canted', engines: 2, paint: '#7f8791', iaf: true, panels: true }), r: 13, personality: 'an Indian Air Force pilot flying the AMCA stealth fighter, proud and razor sharp' },
  a10: { role: 'attack', name: 'A-10 Warthog', group: 'Fighter jets', kind: 'vehicle', domain: 'air', hp: 720, speed: 240, weapon: 'gau8', alt: 'hellfire', sprite: 'fighter', art: JET({ len: 30, body: 5, span: 30, wing: 'straight', tail: 'twinwide', engines: 2, podEngines: true, paint: '#7e8770' }), r: 13, personality: 'gritty close-air-support pilot who loves the BRRRT' },
  bomber: { role: 'attack', name: 'B-52 Stratofortress', group: 'Bombers & drones', kind: 'vehicle', domain: 'air', hp: 900, speed: 210, weapon: 'mg', alt: 'carpet', sprite: 'bomber', art: JET({ len: 44, body: 6, span: 46, wing: 'swept', tail: 'single', engines: 0, pods: 4, paint: '#8a8f86' }), r: 18, personality: 'calm veteran bomber captain' },
  b2: { role: 'attack', name: 'B-2 Spirit', group: 'Bombers & drones', kind: 'vehicle', domain: 'air', hp: 820, speed: 240, weapon: 'mg', alt: 'carpet', sprite: 'bomber', art: { t: 'wing', len: 26, span: 50, paint: '#3e4248' }, r: 18, personality: 'silent stealth bomber pilot' },
  tapas: { role: 'attack', name: 'Tapas UAV', group: 'Bombers & drones', kind: 'vehicle', domain: 'air', hp: 200, speed: 220, weapon: 'mg', alt: 'hellfire', sprite: 'fighter', art: JET({ len: 22, body: 3, span: 32, wing: 'straight', tail: 'vee', paint: '#c4c8cc', drone: true }), r: 10, personality: 'an Indian surveillance drone AI that reports in crisp telemetry' },
  reaper: { role: 'attack', name: 'MQ-9 Reaper Drone', group: 'Bombers & drones', kind: 'vehicle', domain: 'air', hp: 180, speed: 230, weapon: 'mg', alt: 'hellfire', sprite: 'fighter', art: JET({ len: 22, body: 3, span: 30, wing: 'straight', tail: 'vee', paint: '#a8acb0', drone: true }), r: 10, personality: 'a drone AI that speaks in clipped status reports' },

  helicopter: { role: 'attack', name: 'AH-64 Apache', group: 'Helicopters', kind: 'vehicle', domain: 'air', hp: 460, speed: 165, weapon: 'minigun', alt: 'hellfire', sprite: 'heli', art: { t: 'heli', len: 26, body: 6, rotor: 13, stubs: true, paint: '#5f6a4a' }, r: 12, personality: 'steady helicopter gunner' },
  prachand: { role: 'attack', name: 'HAL Prachand', group: 'Helicopters', kind: 'vehicle', domain: 'air', hp: 430, speed: 175, weapon: 'minigun', alt: 'hellfire', sprite: 'heli', art: { t: 'heli', len: 25, body: 5, rotor: 13, stubs: true, paint: '#6b7058' }, r: 12, personality: 'agile high-altitude helicopter pilot from India' },
  hind: { role: 'attack', name: 'Mi-24 Hind', group: 'Helicopters', kind: 'vehicle', domain: 'air', hp: 560, speed: 160, weapon: 'minigun', alt: 'missile', sprite: 'heli', art: { t: 'heli', len: 29, body: 8, rotor: 15, stubs: true, paint: '#7a7a58', camo: '#5e5e44' }, r: 13, personality: 'tough flying-tank pilot' },
  dhruv: { name: 'HAL Dhruv ALH', group: 'Helicopters', kind: 'vehicle', domain: 'air', hp: 400, speed: 172, weapon: 'mg', sprite: 'heli', art: { t: 'heli', len: 26, body: 6, rotor: 13, paint: '#4f5a46' }, r: 12, personality: 'a mountain-rescue helicopter pilot who has flown every Himalayan pass' },
  chinook: { name: 'CH-47 Chinook', group: 'Helicopters', kind: 'vehicle', domain: 'air', hp: 620, speed: 150, weapon: 'mg', sprite: 'heli', art: { t: 'heli', len: 32, body: 8, rotor: 14, twin: true, paint: '#5d6448' }, r: 14, personality: 'easy-going transport pilot' },

  ship: { name: 'Frigate', group: 'Warships', kind: 'vehicle', domain: 'water', hp: 1000, speed: 90, weapon: 'shipgun', alt: 'missile', sprite: 'ship', art: { t: 'ship', len: 46, beam: 11, deck: 'frigate', paint: '#7d8794' }, r: 15, personality: 'salty old captain' },
  destroyer: { name: 'Destroyer', group: 'Warships', kind: 'vehicle', domain: 'water', hp: 1600, speed: 100, weapon: 'shipgun', alt: 'cruise', sprite: 'ship', art: { t: 'ship', len: 60, beam: 13, deck: 'destroyer', paint: '#78838f' }, r: 18, personality: 'sharp destroyer commander' },
  kolkata: { name: 'Kolkata-class Destroyer', group: 'Warships', kind: 'vehicle', domain: 'water', hp: 1800, speed: 100, weapon: 'shipgun', alt: 'brahmos', sprite: 'ship', art: { t: 'ship', len: 62, beam: 13, deck: 'destroyer', paint: '#7a8692' }, r: 18, personality: 'an Indian Navy destroyer captain with BrahMos at the ready' },
  vikrant: { name: 'INS Vikrant', group: 'Warships', kind: 'vehicle', domain: 'water', hp: 4000, speed: 64, weapon: 'ciws', sprite: 'ship', art: { t: 'ship', len: 92, beam: 25, deck: 'carrier', paint: '#646d78' }, r: 29, launches: ['tejas', 'rafale', 'mig29'], launchEvery: 40000, personality: 'the proud admiral of INS Vikrant, the pride of the Indian Navy' },
  corvette: { name: 'Corvette', group: 'Warships', kind: 'vehicle', domain: 'water', hp: 650, speed: 150, weapon: 'autocannon', alt: 'missile', sprite: 'ship', art: { t: 'ship', len: 34, beam: 9, deck: 'corvette', paint: '#86909a' }, r: 12, personality: 'eager young corvette skipper' },
  battleship: { name: 'Battleship', group: 'Warships', kind: 'vehicle', domain: 'water', hp: 3200, speed: 70, weapon: 'naval', alt: 'ciws', sprite: 'ship', art: { t: 'ship', len: 78, beam: 17, deck: 'battleship', paint: '#6f7a86' }, r: 24, personality: 'thunderous old admiral' },
  carrier: { name: 'Aircraft Carrier', group: 'Warships', kind: 'vehicle', domain: 'water', hp: 4200, speed: 62, weapon: 'ciws', sprite: 'ship', art: { t: 'ship', len: 96, beam: 26, deck: 'carrier', paint: '#5f6873' }, r: 30, launches: ['f16', 'fighter', 'rafale', 'tejas'], launchEvery: 40000, personality: 'commanding carrier admiral, proud of the air wing' },
  submarine: { name: 'Submarine', group: 'Warships', kind: 'vehicle', domain: 'water', hp: 900, speed: 95, weapon: 'torpedo', alt: 'cruise', sprite: 'ship', art: { t: 'ship', len: 44, beam: 7, deck: 'sub', paint: '#2e333a' }, stealth: true, r: 12, personality: 'quiet, calculating submarine captain' },
  speedboat: { name: 'Speedboat', group: 'Warships', kind: 'vehicle', domain: 'water', hp: 260, speed: 180, weapon: 'mg', sprite: 'speedboat', r: 8, personality: 'reckless speedboat racer' },

  deer: { name: 'Deer', group: 'Animals', kind: 'npc', domain: 'foot', hp: 60, speed: 115, weapon: null, passive: true, flee: true, sprite: 'deer', r: 6, personality: 'a shy deer' },
  rabbit: { name: 'Rabbit', group: 'Animals', kind: 'npc', domain: 'foot', hp: 15, speed: 120, weapon: null, passive: true, flee: true, sprite: 'rabbit', r: 4, personality: 'a twitchy rabbit' },
  wolf: { name: 'Wolf', group: 'Animals', kind: 'npc', domain: 'foot', hp: 90, speed: 118, weapon: 'bite', sprite: 'wolf', r: 6, personality: 'a fierce wolf, answers in growls' },
  bear: { name: 'Bear', group: 'Animals', kind: 'npc', domain: 'foot', hp: 320, speed: 85, weapon: 'claw', sprite: 'bear', r: 8, personality: 'a huge grumpy bear' },
  shark: { name: 'Shark', group: 'Animals', kind: 'npc', domain: 'water', hp: 220, speed: 115, weapon: 'bite', sprite: 'shark', r: 8, personality: 'a hungry shark' },
  eagle: { name: 'Eagle', group: 'Animals', kind: 'npc', domain: 'air', hp: 40, speed: 160, weapon: null, passive: true, flee: true, sprite: 'eagle', r: 5, personality: 'a proud eagle' },

  alien: { name: 'Alien Trooper', group: 'Aliens', kind: 'npc', domain: 'foot', hp: 160, speed: 95, weapon: 'laser', sprite: 'alien', r: 6, personality: 'an alien speaking in strange clicks, curious about humans' },
  ufo: { name: 'UFO', group: 'Aliens', kind: 'vehicle', domain: 'air', hp: 950, speed: 200, weapon: 'ufoBeam', sprite: 'ufo', r: 12, personality: 'an alien saucer AI, cold and logical' },

  villager: { name: 'Villager', group: 'Civilians', kind: 'npc', domain: 'foot', hp: 50, speed: 70, weapon: 'fists', civ: true, passive: true, flee: true, sprite: 'villager', r: 6, personality: 'a friendly villager who gossips about the town' },
  villager2: { name: 'Townswoman', group: 'Civilians', kind: 'npc', domain: 'foot', hp: 50, speed: 70, weapon: 'fists', civ: true, passive: true, flee: true, sprite: 'villager2', r: 6, personality: 'a sharp-witted townswoman who runs the bakery' },
  farmer: { name: 'Farmer', group: 'Civilians', kind: 'npc', domain: 'foot', hp: 60, speed: 65, weapon: 'fists', civ: true, passive: true, flee: true, sprite: 'farmer', r: 6, personality: 'a hard-working farmer who talks about crops and weather' },
  kurta: { name: 'Townsman', group: 'Civilians', kind: 'npc', domain: 'foot', hp: 50, speed: 70, weapon: 'fists', civ: true, passive: true, flee: true, sprite: 'kurta', r: 6, personality: 'a friendly townsman in a white kurta who talks about cricket and chai' },
  saree: { name: 'Townswoman', group: 'Civilians', kind: 'npc', domain: 'foot', hp: 50, speed: 70, weapon: 'fists', civ: true, passive: true, flee: true, sprite: 'saree', r: 6, personality: 'a sharp, warm townswoman in a bright saree who knows all the local news' },
  student: { name: 'Student', group: 'Civilians', kind: 'npc', domain: 'foot', hp: 40, speed: 80, weapon: 'fists', civ: true, passive: true, flee: true, sprite: 'student', r: 5, personality: 'an excited schoolkid who wants to be a fighter pilot' },
  chaiwala: { name: 'Chaiwala', group: 'Civilians', kind: 'npc', domain: 'foot', hp: 55, speed: 68, weapon: 'fists', civ: true, passive: true, flee: true, sprite: 'chaiwala', r: 6, personality: 'a chai seller who offers everyone tea and opinions' },
  prisoner: { name: 'Prisoner', group: 'Civilians', kind: 'npc', domain: 'foot', hp: 60, speed: 74, weapon: 'fists', civ: true, passive: true, flee: true, sprite: 'prisoner', r: 6, personality: 'a jail inmate who swears he is innocent' },
  auto: { name: 'Auto Rickshaw', group: 'Traffic', kind: 'vehicle', domain: 'land', hp: 120, speed: 95, weapon: null, civ: true, passive: true, traffic: true, sprite: 'humvee', art: { t: 'car', style: 'auto', len: 12, wid: 8, body: '#f2c21b' }, r: 6, personality: 'a talkative auto driver who knows a shortcut everywhere' },
  taxi: { name: 'Taxi', group: 'Traffic', kind: 'vehicle', domain: 'land', hp: 160, speed: 110, weapon: null, civ: true, passive: true, traffic: true, sprite: 'humvee', art: { t: 'car', style: 'car', len: 15, wid: 8, body: '#1c1c1c', roof: '#f2c21b' }, r: 7, personality: 'a city taxi driver with strong opinions' },
  car: { name: 'Car', group: 'Traffic', kind: 'vehicle', domain: 'land', hp: 170, speed: 120, weapon: null, civ: true, passive: true, traffic: true, paintVariety: true, sprite: 'humvee', art: { t: 'car', style: 'car', len: 15, wid: 8, body: 'K' }, r: 7, personality: 'a commuter stuck in traffic again' },
  bus: { name: 'City Bus', group: 'Traffic', kind: 'vehicle', domain: 'land', hp: 400, speed: 80, weapon: null, civ: true, passive: true, traffic: true, paintVariety: true, sprite: 'humvee', art: { t: 'car', style: 'bus', len: 30, wid: 10, body: 'K' }, r: 11, personality: 'a patient bus driver who stops for everyone' },
  lorry: { name: 'Cargo Truck', group: 'Traffic', kind: 'vehicle', domain: 'land', hp: 380, speed: 75, weapon: null, civ: true, passive: true, traffic: true, sprite: 'humvee', art: { t: 'car', style: 'lorry', len: 26, wid: 10, body: '#e07a20' }, r: 10, personality: 'a long-haul trucker with a painted truck that says HORN OK PLEASE' },
  scooter: { name: 'Scooter', group: 'Traffic', kind: 'vehicle', domain: 'land', hp: 60, speed: 125, weapon: null, civ: true, passive: true, traffic: true, paintVariety: true, sprite: 'humvee', art: { t: 'car', style: 'scooter', len: 9, wid: 4, body: 'K' }, r: 5, personality: 'a scooter rider late for college' },
  tractor: { name: 'Tractor', group: 'Traffic', kind: 'vehicle', domain: 'land', hp: 240, speed: 60, weapon: null, civ: true, passive: true, traffic: true, sprite: 'humvee', art: { t: 'car', style: 'tractor', len: 14, wid: 9, body: '#c8302a' }, r: 7, personality: 'a farmer on a tractor who is in no hurry' },
  ambulance: { name: 'Ambulance', group: 'Traffic', kind: 'vehicle', domain: 'land', hp: 220, speed: 135, weapon: null, civ: true, passive: true, traffic: true, supply: true, sprite: 'humvee', art: { t: 'car', style: 'van', len: 17, wid: 9, body: '#f4f4f2', stripe: '#e02828', flash: 'ambulance' }, r: 8, personality: 'a paramedic who heals anyone nearby' },
  policejeep: { name: 'Police Jeep', group: 'Police', kind: 'vehicle', domain: 'land', hp: 300, speed: 140, weapon: 'pistol', sprite: 'humvee', art: { t: 'car', style: 'van', len: 16, wid: 9, body: '#f4f4f2', stripe: '#2a50c8', flash: 'police' }, r: 8, personality: 'a highway patrol officer with a siren and no patience' },
  merchant: { name: 'Merchant', group: 'Civilians', kind: 'npc', domain: 'foot', hp: 50, speed: 70, weapon: 'fists', civ: true, passive: true, flee: true, sprite: 'merchant', r: 6, personality: 'a shrewd merchant always looking for a deal' },
};

export const CIVILIANS = ['villager', 'villager2', 'farmer', 'merchant'];
export const CIVILIANS_IN = ['kurta', 'saree', 'kurta', 'saree', 'student', 'chaiwala', 'farmer'];
export const TRAFFIC = ['auto', 'auto', 'taxi', 'car', 'car', 'scooter', 'scooter', 'bus', 'lorry', 'tractor', 'ambulance'];
export const CAR_COLORS = ['#e8e8ea', '#c82a2a', '#2a2a2e', '#8a8f98', '#2a5ac8', '#f0f0f0', '#9a1f2a', '#3a7a4a', '#d8c8a0'];

// cat: Build panel category. flat: units/vehicles move over it, bullets fly over it. ground: drawn under units.
// decor: street furniture: never targeted, doesn't count as a kingdom building, doesn't block.
export const BUILD_CATS = ['Royal', 'Military', 'Defence', 'Housing', 'Commerce', 'Civic', 'Faith & landmarks', 'Infrastructure', 'Street & decor', 'Forged'];
export const BUILDINGS = {
  castle: { name: 'Castle', cat: 'Royal', hp: 3500, w: 3, h: 3, unique: true },
  fort: { name: 'Lal Qila Fort', cat: 'Royal', hp: 5000, w: 4, h: 3, weapon: 'towerbow', produces: ['jawan', 'commando'], every: 30000 },
  townhall: { name: 'Town Hall', cat: 'Civic', hp: 1600, w: 2, h: 2, town: true },
  house: { name: 'House', cat: 'Housing', hp: 300, w: 1, h: 1, residents: 2 },
  apartment: { name: 'Apartment Block', cat: 'Housing', hp: 600, w: 1, h: 1, residents: 4, variants: 4 },
  stonehut: { name: 'Himalayan Stone House', cat: 'Housing', hp: 400, w: 1, h: 1, residents: 2 },
  market: { name: 'Market', cat: 'Commerce', hp: 500, w: 2, h: 2 },
  shop: { name: 'Dukaan (Shop Row)', cat: 'Commerce', hp: 500, w: 2, h: 1, residents: 1, variants: 4 },
  highrise: { name: 'High-rise Tower', cat: 'Commerce', hp: 1400, w: 2, h: 2, residents: 6 },
  mall: { name: 'Shopping Mall', cat: 'Commerce', hp: 1600, w: 3, h: 2 },
  hospital: { name: 'Hospital', cat: 'Civic', hp: 900, w: 2, h: 2, heal: 240 },
  police: { name: 'Police Station', cat: 'Civic', hp: 1100, w: 2, h: 2, produces: ['police', 'police', 'policejeep'], every: 35000 },
  jail: { name: 'District Jail', cat: 'Civic', hp: 3200, w: 4, h: 4, weapon: 'bunkermg', produces: ['guard'], every: 40000, residents: 6, residentType: 'prisoner' },
  well: { name: 'Well', cat: 'Infrastructure', hp: 200, w: 1, h: 1 },
  farm: { name: 'Farm', cat: 'Infrastructure', hp: 200, w: 2, h: 2, flat: true, ground: true },
  windmill: { name: 'Windmill', cat: 'Infrastructure', hp: 350, w: 1, h: 1 },
  railway: { name: 'Railway Station', cat: 'Infrastructure', hp: 1800, w: 5, h: 2 },
  powerplant: { name: 'Power Plant', cat: 'Infrastructure', hp: 2000, w: 3, h: 3 },
  watertower: { name: 'Water Tower', cat: 'Infrastructure', hp: 500, w: 1, h: 1 },
  pylon: { name: 'Power Pylon', cat: 'Infrastructure', hp: 300, w: 1, h: 1, decor: true },
  lighthouse: { name: 'Lighthouse', cat: 'Infrastructure', hp: 700, w: 1, h: 1 },
  road: { name: 'Road', cat: 'Street & decor', hp: 99999, w: 1, h: 1, flat: true, ground: true, decor: true },
  lamp: { name: 'Street Lamp', cat: 'Street & decor', hp: 100, w: 1, h: 1, decor: true },
  chaistall: { name: 'Chai Stall', cat: 'Street & decor', hp: 120, w: 1, h: 1, decor: true },
  fruitcart: { name: 'Fruit Cart', cat: 'Street & decor', hp: 100, w: 1, h: 1, decor: true },
  busstop: { name: 'Bus Stop', cat: 'Street & decor', hp: 150, w: 1, h: 1, decor: true },
  hoarding: { name: 'Hoarding', cat: 'Street & decor', hp: 150, w: 1, h: 1, decor: true, variants: 4 },
  signal: { name: 'Traffic Signal', cat: 'Street & decor', hp: 100, w: 1, h: 1, decor: true },
  church: { name: 'Church', cat: 'Faith & landmarks', hp: 800, w: 2, h: 2 },
  mandir: { name: 'Mandir (Temple)', cat: 'Faith & landmarks', hp: 900, w: 2, h: 2 },
  grandmandir: { name: 'Grand Mandir', cat: 'Faith & landmarks', hp: 4000, w: 4, h: 3, heal: 260 },
  masjid: { name: 'Masjid (Mosque)', cat: 'Faith & landmarks', hp: 900, w: 2, h: 2 },
  gurudwara: { name: 'Gurudwara', cat: 'Faith & landmarks', hp: 900, w: 2, h: 2 },
  stupa: { name: 'Himalayan Monastery', cat: 'Faith & landmarks', hp: 1200, w: 3, h: 2 },
  archgate: { name: 'Victory Arch', cat: 'Faith & landmarks', hp: 2500, w: 2, h: 1 },
  wall: { name: 'Wall', cat: 'Defence', hp: 450, w: 1, h: 1 },
  fence: { name: 'Military Fence', cat: 'Defence', hp: 300, w: 1, h: 1 },
  tower: { name: 'Tower', cat: 'Defence', hp: 650, w: 1, h: 1, weapon: 'towerbow' },
  samsite: { name: 'SAM Site', cat: 'Defence', hp: 800, w: 1, h: 1, weapon: 'sam' },
  bunker: { name: 'Bunker', cat: 'Defence', hp: 1400, w: 1, h: 1, weapon: 'bunkermg' },
  radar: { name: 'Radar Station', cat: 'Defence', hp: 600, w: 1, h: 1 },
  brahmosbase: { name: 'BrahMos Battery', cat: 'Defence', hp: 2200, w: 2, h: 2, weapon: 'brahmos' },
  airport: { name: 'Airport', cat: 'Military', hp: 4500, w: 16, h: 5, runway: true, ground: true, produces: ['f16', 'tejas', 'rafale', 'su30', 'amca', 'typhoon', 'mig29', 'f22', 'a10'], every: 70000, parked: true },
  barracks: { name: 'Barracks', cat: 'Military', hp: 900, w: 2, h: 2, produces: ['knight', 'archer', 'rifleman', 'jawan', 'jawan', 'gunner'], every: 18000 },
  cantonment: { name: 'Cantonment (Special Forces)', cat: 'Military', hp: 1300, w: 3, h: 2, produces: ['commando', 'sniper', 'rpgman', 'jawan', 'gunner'], every: 25000 },
  stable: { name: 'Stable', cat: 'Military', hp: 600, w: 2, h: 2, produces: ['horse'], every: 30000 },
  factory: { name: 'War Factory', cat: 'Military', hp: 1200, w: 2, h: 2, produces: ['tank', 'arjun', 't90', 'humvee', 'apc', 'artillery', 'mlrs'], every: 45000 },
  armydepot: { name: 'Army Depot', cat: 'Military', hp: 1500, w: 3, h: 2, produces: ['bmp2', 'k9', 'pinaka', 'gypsy', 'armytruck', 'brahmosl', 'arjun'], every: 45000 },
  airbase: { name: 'Airstrip', cat: 'Military', hp: 1000, w: 2, h: 2, runway: true, produces: ['f16', 'tejas', 'rafale', 'fighter', 'su30', 'amca', 'f22', 'mig29', 'typhoon', 'a10', 'reaper', 'tapas', 'bomber', 'b2'], every: 55000 },
  helipad: { name: 'Helipad', cat: 'Military', hp: 700, w: 2, h: 2, flat: true, ground: true, produces: ['helicopter', 'prachand', 'dhruv', 'hind', 'chinook'], every: 50000 },
  harbor: { name: 'Harbor', cat: 'Military', hp: 1000, w: 2, h: 2, produces: ['ship', 'speedboat', 'corvette'], every: 60000, coastal: true },
  shipyard: { name: 'Naval Shipyard', cat: 'Military', hp: 1800, w: 3, h: 2, produces: ['destroyer', 'kolkata', 'submarine', 'battleship', 'carrier', 'vikrant', 'ship'], every: 90000, coastal: true },
};
export const DAY_MS = 10 * 60000; // one full day/night cycle

export const UNIT_CAP = 90; // combat units per kingdom, keeps the server responsive
export const CIV_CAP = 60; // civilians per kingdom

// --- Pixel sprites ---------------------------------------------------------
// Each char maps to a colour. K/k = kingdom colour (light/dark), '.' = transparent.
export const PALETTE = {
  s: '#f1c27d', S: '#c98d55', h: '#b8c0cc', H: '#6b7480', d: '#2a2a2e', e: '#141418', w: '#f0f0f0',
  g: '#ecc94b', b: '#7a5230', B: '#4e3420', G: '#8a8f98', o: '#5f6b3a', O: '#3f4a26', r: '#c83a3a',
  y: '#ffe066', c: '#7fd0ff', n: '#3a3a44', a: '#7ae05a', A: '#3f8a2e', p: '#7a4ad0', t: '#c8a878',
  j: '#c88a58', J: '#9a6440', x: '#b8a06a', X: '#8a7442', q: '#f08a24', Q: '#c0601a', m: '#8a1f34', u: '#3a5ac8', U: '#243870', i: '#e0408a', v: '#2e9a46',
};

export const SPRITES = {
  jawan: ['....OOO.....', '...ooooo....', '..oOOOOOo...', '...jejejj...', '...jjjjj....', '..oKoooKo...', '.joooooooj..', '.joOOOOOoj..', '..ooooooo...', '..OOOOOOO...', '...oo.oo....', '...oo.oo....', '...dd.dd....'],
  commando: ['............', '...mmmm.....', '..mmmmmm....', '...jejej....', '...jjjjj....', '..nKnnnKn...', '.jnnOnnnnj..', '.jnnnnOnnj..', '..nnOnnnn...', '..ddddddd...', '...nn.nn....', '...nn.nn....', '...dd.dd....'],
  sniper: ['...AoOAo....', '..oAOoAOo...', '..AoOAoOA...', '...jejej....', '..AjjjjjA...', '.oAOoAOoAo..', '.jOAoKoAOj..', '.joAOoAoAj..', '..AoOAoOA...', '..OAoOAoO...', '...oA.Ao....', '...oo.oo....', '...dd.dd....'],
  police: ['....UUU.....', '...UUUUU....', '...rrrrr....', '...jejej....', '...jjjjj....', '..xxxxxxx...', '.jxxKxxxxj..', '.jxXXXXXxj..', '..xxxxxxx...', '..xxxxxxx...', '...xx.xx....', '...xx.xx....', '...BB.BB....'],
  prisoner: ['....ddd.....', '...ddddd....', '...jjjjj....', '...jejej....', '...jjjjj....', '..qqqqqqq...', '.jqQqQqQqj..', '.jqqqqqqqj..', '..qQqQqQq...', '..qqqqqqq...', '...qq.qq....', '...qq.qq....', '...BB.BB....'],
  kurta: ['....ddd.....', '...ddddd....', '...jjjjj....', '...jejej....', '...jjjjj....', '..wwwwwww...', '.jwwwwwwwj..', '.jwwKwwwwj..', '..wwwwwww...', '..wwwwwww...', '..wwwwwww...', '...hh.hh....', '...BB.BB....'],
  saree: ['....ddd.....', '...ddddd....', '..djjjjjd...', '..djejejd...', '...jjjjj....', '..iiiigg....', '.jiiiiiggj..', '.jiiiiiiigj.', '..iiiiiig...', '.iiiiiiiii..', '.iiiiiiiii..', '.ggggggggg..', '...BB.BB....'],
  student: ['....ddd.....', '...ddddd....', '...jjjjj....', '...jejej....', '...jjjjj....', '..wwwwwwK...', '.jwwwwwwKK..', '.jwwwwwwK...', '..UUUUUUU...', '..UUUUUUU...', '...jj.jj....', '...jj.jj....', '...dd.dd....'],
  chaiwala: ['....ddd.....', '...ddddd....', '...jjjjj....', '...jejej....', '...jjjjj....', '..jwwwwwj...', '.jjwwwwwjj..', '.j.wwwwwj...', '..vgvgvgv...', '..gvgvgvg...', '..vgvgvgv...', '...jj.jj....', '...BB.BB....'],  king: ['...g.g.g....', '...ggggg....', '...sssss....', '...sesess...', '...sssss....', '..KKKKKKK...', '.kKKgKgKKk..', '.sKKKgKKKs..', '.sKKKKKKKs..', '..KKKKKKK...', '..kkkkkkk...', '...bb.bb....', '...bb.bb....', '...BB.BB....'],
  knight: ['....HHH.....', '...HhhhH....', '...HdddH....', '...HhhhH....', '....HHH.....', '..KKhKhKK...', '.hKKKwKKKh..', '.sKKwwwKKs..', '.sKKKwKKKs..', '..KKKKKKK...', '..bbbbbbb...', '...hh.hh....', '...hh.hh....', '...HH.HH....'],
  archer: ['....kkk.....', '...kKKKk....', '..kKsssKk...', '..kseseKk...', '...ssssk....', '..kKKKKKk...', '.sKKbKKKs...', '.sKKKbKKs...', '..KKKKbK....', '..kkkkkk....', '...oo.oo....', '...oo.oo....', '...BB.BB....'],
  soldier: ['....ooo.....', '...ooooo....', '..oOOOOOo...', '...sesess...', '...sssss....', '..oKKKKKo...', '.soKKKKKos..', '.soOOOOOos..', '..oKKKKKo...', '..OOOOOOO...', '...oo.oo....', '...oo.oo....', '...dd.dd....'],
  pilot: ['....www.....', '...wwwww....', '...wcccw....', '...wsssw....', '....sss.....', '..oKKKKKo...', '.soKKKKKos..', '.soKgKKKos..', '..oKKKKKo...', '..ooooooo...', '...oo.oo....', '...oo.oo....', '...dd.dd....'],
  militia: ['....HHH.....', '...HHHHH....', '...sssss....', '...sesess...', '...sssss....', '..bbbbbbb...', '.sbbbbbbbs..', '.sbbKKKbbs..', '..bbbbbbb...', '..BBBBBBB...', '...bb.bb....', '...bb.bb....', '...BB.BB....'],
  villager: ['....BBB.....', '...BBBBB....', '...sssss....', '...sesess...', '...sssss....', '..ttttttt...', '.sttKKKtts..', '.sttttttts..', '..ttttttt...', '..ttttttt...', '...SS.SS....', '...SS.SS....', '...BB.BB....'],
  villager2: ['...yyyyy....', '..yyyyyyy...', '..ysssssy...', '..ysesesy...', '..ysssssy...', '..yrrrrry...', '.srrKKKrrs..', '.srrrrrrrs..', '..rrrrrrr...', '.rrrrrrrrr..', '.rrrrrrrrr..', '...SS.SS....', '...BB.BB....'],
  farmer: ['..ggggggg...', 'gggggggggg..', '...sssss....', '...sesess...', '...sssss....', '..ooooooo...', '.soKKKKKos..', '.sooooooos..', '..bbbbbbb...', '..bbbbbbb...', '...bb.bb....', '...bb.bb....', '...BB.BB....'],
  merchant: ['....ppp.....', '...ppppp....', '...sssss....', '...sesess...', '...sssss....', '..ppgggpp...', '.sppppppps..', '.spppKppps..', '..ppppppp...', '..ppppppp...', '..ppppppp...', '...BB.BB....'],
  alien: ['...aaaaa....', '..aaaaaaa...', '..aeeaeea...', '..aeeaeea...', '...aaaaa....', '....aaa.....', '..ppppppp...', '.appppppa...', '.apppKppa...', '..ppppppp...', '...pp.pp....', '...pp.pp....', '...AA.AA....'],
  tank: ['dndndndndndnd...', 'nGGGGGGGGGGGn...', 'dndndndndndnd...', '..kKKKKKKKKk....', '..KKKkkkkKKK....', '..KKkKKKKkKKHHHH', '..KKkKKKKkKKHHHH', '..KKKkkkkKKK....', '..kKKKKKKKKk....', 'dndndndndndnd...', 'nGGGGGGGGGGGn...', 'dndndndndndnd...'],
  humvee: ['.dd......dd...', 'ooooooooooooo.', 'oOOOOOOOOccoo.', 'oOKKKdKKOccooy', 'oOKKdddHHHHoo.', 'oOKKKdKKOccooy', 'oOOOOOOOOccoo.', 'ooooooooooooo.', '.dd......dd...'],
  jet: ['....kk..........', '....KKk.........', '.....KKk........', 'kk....KKk.......', 'KKk...KKKKk.....', 'KKKKKKKKKKKKKcc.', 'KKKKKKKKKKKKKccG', 'KKk...KKKKk.....', 'kk....KKk.......', '.....KKk........', '....KKk.........', '....kk..........'],
  fighter: ['......HH..........', '......hHH.........', '.......hHH........', 'HH.....hhHH.......', 'hHH....hhhhH......', '.hhhhhhhhhhhhhHcc.', '.KKKKKKKKKKKKKhccd', '.hhhhhhhhhhhhhHcc.', 'hHH....hhhhH......', 'HH.....hhHH.......', '.......hHH........', '......hHH.........', '......HH..........'],
  bomber: ['..........kk..........', '.........KKKk.........', '........KKKKk.........', '.......KKKKKk.........', 'kk....KKKKKKk.........', 'KKk..KKKKKKKKk........', 'KKKKKKKKKKKKKKKKKKKcc.', 'KKKKKKKKKKKKKKKKKKKccd', 'KKk..KKKKKKKKk........', 'kk....KKKKKKk.........', '.......KKKKKk.........', '........KKKKk.........', '.........KKKk.........', '..........kk..........'],
  heli: ['................', '......dd........', '..d...KKKK......', '..dd.KKKKKK.....', '..dKKKKKKKKcc...', 'dddKKKKKKKKccd..', '..dKKKKKKKKcc...', '..dd.KKKKKK.....', '..d...KKKK......', '......dd........'],
  ship: ['..........HH..........', '.........HHHH.........', '....hhhhhhhhhhhhh.....', '....hwwhwwhwwhwwh..GG.', 'BbbbbbbbbbbbbbbbbbbGG.', 'BKKKKKKKKKKKKKKKKKKKbb', 'BkkkkkkkkkkkkkkkkkkkkB', '.BbbbbbbbbbbbbbbbbbbB.', '..BBBBBBBBBBBBBBBBBB..'],
  speedboat: ['..ww..........', 'wwwwwwwwwww...', 'wKKKKKKKKKKKw.', 'wKKKccKKKKKKKw', 'wKKKKKKKKKKKw.', 'wwwwwwwwwww...', '..ww..........'],
  horse: ['..........bb..', '.........bbbb.', '.........bbbbe', '........bbbbbb', '..BBbbKKbbb...', '.BbbbKKKbbB...', 'B.bbbbbbbbb...', '..bbbbbbbb....', '..b.b...b.b...', '..b.b...b.b...', '..B.B...B.B...'],
  deer: ['........S..S', '.........SS.', '.........bb.', '........bbbd', '..bbbbbbbb..', '.bbwbbbbbb..', '..bbbwbbbb..', '..b.b..b.b..', '..b.b..b.b..', '..d.d..d.d..'],
  rabbit: ['...ww.', '...ww.', '.wwwwe', 'wwwww.', '.w..w.'],
  wolf: ['.........GG.', '........GGGG', 'G.GGGGGGGGed', '.GGGGGGGGGG.', '..GGGGGGGG..', '..G.G..G.G..', '..G.G..G.G..', '..d.d..d.d..'],
  bear: ['..........BB..', '.........BBBBB', '..BBBBBBBBBBeB', '.BBBBBBBBBBBBd', '.BBBBBBBBBBBB.', '.BBBBBBBBBBB..', '..BBB...BBB...', '..BB....BB....', '..dd....dd....'],
  shark: ['......G.........', '.....GGG........', 'G...GGGGGGGG....', 'GGGGGGGGGGGGGGw.', 'G...GGGGGGGG....', '.....GGG........', '......G.........'],
  eagle: ['...BB.......', '....BBB.....', 'BB...BBBB...', '.BBBBBBBBwwy', 'BB...BBBB...', '....BBB.....', '...BB.......'],
  ufo: ['.......cccc.......', '......cccccc......', '....GGGGGGGGGG....', '..GGhhhhhhhhhhGG..', 'GGhhahhhahhhahhhGG', '..GGGGGGGGGGGGGG..', '....a..a..a..a....'],
};

// Top-down sprites that rotate with heading; everything else is side/front view and flips
export const ROTATING = new Set(['tank', 'humvee', 'jet', 'fighter', 'bomber', 'heli', 'ship', 'speedboat', 'shark', 'eagle']);
export const UNIT_GROUPS = ['Forged', 'Soldiers', 'Special forces', 'Police', 'Ground vehicles', 'Artillery & missiles', 'Fighter jets', 'Bombers & drones', 'Helicopters', 'Warships', 'Traffic', 'Civilians', 'Animals', 'Aliens'];
export const NOFLIP = new Set(['ufo']);
export const HUMANOID = new Set(['pilot', 'king', 'knight', 'archer', 'soldier', 'militia', 'villager', 'villager2', 'farmer', 'merchant', 'alien', 'jawan', 'commando', 'sniper', 'police', 'prisoner', 'kurta', 'saree', 'student', 'chaiwala']);

export const TOWN_NAMES = ['Oakford', 'Millbrook', 'Stonebridge', 'Ravenhill', 'Willowmere', 'Ambergate', 'Thornbury', 'Larkspur', 'Fairhaven', 'Copperfield', 'Mistwood', 'Redwater', 'Brackenridge', 'Harrowgate', 'Elmstead', 'Saltmarsh', 'Kingsbarrow', 'Goldmeadow', 'Ironford', 'Windcrest', 'Ashby', 'Dunmore', 'Pinecrest', 'Hollowdale', 'Brightwater', 'Foxley', 'Greystone', 'Moorfield', 'Sunhaven', 'Wolfden', 'Cliffside', 'Rosewick', 'Silverbrook', 'Deepvale', 'Eastmarch', 'Northwatch', 'Highcairn', 'Lowmere', 'Seabright', 'Frostford'];

// name themes for kingdoms & towns ('india' is the default; real-world maps use real city names)
export const NAME_THEMES = {
  india: {
    label: 'Indian',
    kingdoms: ['Maurya', 'Chola', 'Maratha', 'Rajputana', 'Vijayanagara', 'Kalinga', 'Magadha', 'Pandya', 'Kamarupa', 'Gupta'],
    towns: ['Rampur', 'Sitapur', 'Chandrapur', 'Devgarh', 'Suryanagar', 'Kalyanpur', 'Ratnagiri', 'Shivpuri', 'Haripur', 'Lakshmipur', 'Govindgarh', 'Madhupur', 'Ramnagar', 'Krishnanagar', 'Anandpur', 'Sonpur', 'Rajgarh', 'Sundarpur', 'Mangalpur', 'Nandgaon', 'Gopalpur', 'Vijaypur', 'Indrapuri', 'Shantinagar', 'Kamalpur', 'Badrinagar', 'Tarapur', 'Motinagar', 'Hiranagar', 'Neelgiri', 'Kesarpur', 'Amarpur', 'Surajpur', 'Durgapur', 'Ganeshpur', 'Raigarh', 'Udaygarh', 'Kishangarh', 'Jaigarh', 'Panchgani', 'Mahabaleshwar', 'Khandala', 'Ooty', 'Munnar', 'Almora', 'Nainital', 'Kasauli', 'Lonavala', 'Matheran', 'Pushkar', 'Orchha', 'Mandu', 'Khajuraho', 'Konark', 'Sanchi', 'Dharampur', 'Bilaspur', 'Karnal', 'Panipat', 'Alwar', 'Tonk', 'Sikar', 'Barmer', 'Chittorgarh', 'Kumbhalgarh', 'Bundi', 'Kota', 'Mathura', 'Vrindavan', 'Haridwar', 'Kurukshetra', 'Gaya', 'Nalanda', 'Rajgir', 'Darbhanga', 'Cuttack', 'Kanchipuram', 'Thanjavur', 'Chidambaram', 'Kumbakonam', 'Alappuzha', 'Kollam', 'Udupi', 'Hubli', 'Belgaum', 'Bijapur', 'Gulbarga', 'Nanded', 'Amravati', 'Akola', 'Jalgaon', 'Satara', 'Sangli', 'Solapur'],
  },
  fantasy: {
    label: 'Fantasy',
    kingdoms: ['Ashvale', 'Brightmoor', 'Cindercrest', 'Dunholm', 'Eldergrove', 'Frostmark', 'Goldreach', 'Highstone', 'Ironwood', 'Jadecliff'],
    towns: TOWN_NAMES,
  },
};
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
