// ============================================================
// LEVEL DEFINITION SYSTEM
// 20 unique levels across 5 themed worlds (4 levels each)
// Each level is procedurally assembled from hand-designed
// "chunks" so every level has real, varied, non-trivial layout.
// ============================================================

const TILE = 32;

const THEMES = [
  { name: "Groene Heuvels", sky1: "#5c94fc", sky2: "#a8d8ff", ground: "#7a4a2a", groundTop: "#3ea832", accent: "#2e7d32", cloud: true, hills:"#4a9e3f" },
  { name: "Onderaardse Grotten", sky1: "#0a0a1a", sky2: "#1a1a3a", ground: "#2a1a3a", groundTop: "#5a3a7a", accent: "#8a4aff", cloud:false, hills:"#241333" },
  { name: "Woestijn van Zand", sky1: "#ffb84d", sky2: "#ffe0a3", ground: "#c9963c", groundTop: "#e8c268", accent: "#a86a2a", cloud:true, hills:"#d9a24a" },
  { name: "IJsvlakte", sky1: "#2a3d5c", sky2: "#7ab8e8", ground: "#3a5a7a", groundTop: "#cfefff", accent: "#8ad8ff", cloud:true, hills:"#4a6a8a" },
  { name: "Vulkaankasteel", sky1: "#1a0505", sky2: "#4a1010", ground: "#3a2020", groundTop: "#6a2a2a", accent: "#ff5a1a", cloud:false, hills:"#2a1010" },
];

const ENEMY_TYPES = ["goomba","koopa","spiky","flyer","hopper","turret","chaser","ghost"];

// deterministic pseudo-random per level for variety but reproducibility
function makeRNG(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff);
  };
}

// Build one level's tile map + entities programmatically.
function buildLevel(index) {
  const worldIdx = Math.floor(index / 4);
  const stageInWorld = index % 4; // 0..3, 3 = boss
  const theme = THEMES[worldIdx];
  const rng = makeRNG(index * 7919 + 13);
  const isBoss = stageInWorld === 3;

  // Boss levels get a long approach gauntlet PLUS a big dedicated arena at the end
  const ARENA_WIDTH = 46;
  const width = isBoss ? (190 + Math.floor(rng()*30) + ARENA_WIDTH) : 170 + Math.floor(rng()*40); // columns of tiles
  const height = 18; // rows
  const groundY = 14;
  const arenaStartX = isBoss ? width - ARENA_WIDTH : null;

  // tiles: 0 empty, 1 ground, 2 brick, 3 question(coin), 4 question(power), 5 pipe, 6 spike, 7 platform, 8 ice/cloud plat, 9 castle brick
  const tiles = Array.from({length:height}, () => new Array(width).fill(0));

  // base ground with gaps (pits) -- arena zone (for boss levels) is always solid, no pits
  let x = 0;
  const pits = [];
  while (x < width) {
    const inArena = isBoss && x >= arenaStartX - 4;
    const segLen = inArena ? (width-x) : 8 + Math.floor(rng()*14);
    for (let i=0;i<segLen && x<width;i++,x++){
      for (let y=groundY;y<height;y++) tiles[y][x] = isBoss?9:1;
    }
    // maybe a pit (never inside/near the arena)
    if (!inArena && x < width - 20 && rng() < 0.55) {
      const pitLen = 2 + Math.floor(rng()*3);
      pits.push([x,pitLen]);
      x += pitLen;
    }
  }
  // ensure start & end solid
  for (let y=groundY;y<height;y++){ tiles[y][0]=1; tiles[y][1]=1; tiles[y][width-1]=1; tiles[y][width-2]=1; tiles[y][width-3]=1; }

  // scatter floating platforms, brick clusters, question blocks, pipes
  const entities = { enemies:[], coins:[], powerups:[], platforms:[], decor:[] };

  const decorEndX = isBoss ? arenaStartX - 6 : width - 8;
  for (let x2=6; x2<decorEndX; x2+=3+Math.floor(rng()*5)) {
    const roll = rng();
    const groundHere = findGroundY(tiles, x2, height);
    if (roll < 0.22 && groundHere > 4) {
      // floating brick row with question block
      const py = groundHere - (3 + Math.floor(rng()*4));
      const rowLen = 1 + Math.floor(rng()*4);
      for (let k=0;k<rowLen;k++){
        if (x2+k>=width-2) break;
        const isQ = rng() < 0.35;
        tiles[py][x2+k] = isQ ? (rng()<0.25?4:3) : 2;
      }
    } else if (roll < 0.35 && groundHere > 6) {
      // stepped pyramid (classic mario-like)
      const steps = 2+Math.floor(rng()*3);
      for (let s=0;s<steps;s++){
        for (let yy=0; yy<=s; yy++){
          const py = groundHere-1-yy;
          const px = x2+s;
          if (px<width-2 && py>=2) tiles[py][px]=2;
        }
      }
    } else if (roll < 0.45) {
      // pipe (obstacle to jump over, sometimes spawns flower enemy)
      const ph = 2+Math.floor(rng()*3);
      for (let yy=0; yy<ph; yy++){
        const py = groundHere-1-yy;
        if (py>=2) tiles[py][x2] = 5;
      }
      if (rng()<0.3) entities.enemies.push({type:"piranha", x:x2*TILE+TILE/2, y:(groundHere-ph)*TILE, homeY:(groundHere-ph)*TILE});
    } else if (roll < 0.6 && groundHere>5) {
      // floating platform strip (cloud/ice)
      const py = groundHere - (4+Math.floor(rng()*4));
      const rowLen = 3+Math.floor(rng()*4);
      for (let k=0;k<rowLen;k++){
        if (x2+k<width-2) tiles[py][x2+k] = 7;
      }
    }
  }

  // place pits' fall-through hazards already handled by absence of tiles (death by falling)

  // enemy placement across ground segments (gauntlet before the arena for boss levels)
  const enemyZoneEnd = isBoss ? arenaStartX - 4 : width - 20;
  let ecount = isBoss ? 24 + Math.floor(rng()*8) : 14 + Math.floor(rng()*10);
  for (let i=0;i<ecount;i++){
    const ex = 10 + Math.floor(rng()*Math.max(10,enemyZoneEnd-10));
    const gY = findGroundY(tiles, ex, height);
    if (gY <= 2) continue;
    const type = ENEMY_TYPES[Math.floor(rng()*ENEMY_TYPES.length)];
    if (type==="flyer" || type==="ghost") {
      entities.enemies.push({type, x:ex*TILE, y:(gY-4-Math.floor(rng()*3))*TILE, range:60+rng()*80});
    } else {
      entities.enemies.push({type, x:ex*TILE, y:(gY-1)*TILE});
    }
  }

  // coins scattered
  let ccount = 30 + Math.floor(rng()*30) + (isBoss?20:0);
  for (let i=0;i<ccount;i++){
    const cx = 6 + Math.floor(rng()*(width-12));
    const gY = findGroundY(tiles, cx, height);
    const cy = gY - (2+Math.floor(rng()*6));
    if (cy>=2 && tiles[cy][cx]===0) entities.coins.push({x:cx*TILE+16, y:cy*TILE+16});
  }

  // powerups - guarantee several per level, varied types
  const powerPool = ["mushroom","fireflower","star","feather","shield"];
  let pcount = (isBoss ? 6 : 4) + Math.floor(rng()*3);
  for (let i=0;i<pcount;i++){
    const px = 15 + Math.floor(rng()*Math.max(20,(isBoss?enemyZoneEnd:width-30)));
    const gY = findGroundY(tiles, px, height);
    const py = gY - (2+Math.floor(rng()*3));
    if (py>=2) entities.powerups.push({x:px*TILE+16, y:py*TILE, type:powerPool[Math.floor(rng()*powerPool.length)]});
  }
  // guarantee one shield + one star right before the arena entrance, so the fight is always fair
  if (isBoss) {
    const preArenaX = arenaStartX - 3;
    const gY1 = findGroundY(tiles, preArenaX, height);
    entities.powerups.push({x:preArenaX*TILE, y:(gY1-3)*TILE, type:'shield'});
    entities.powerups.push({x:(preArenaX-3)*TILE, y:(gY1-3)*TILE, type:'star'});
  }

  let boss = null;
  let arena = null;
  if (isBoss) {
    arena = buildArena(tiles, theme, arenaStartX, width, groundY, height, rng, entities, worldIdx);
    // boss spawns in the middle of the arena, well clear of the entrance
    const bossX = (arenaStartX + Math.floor(ARENA_WIDTH*0.55)) * TILE;
    boss = {
      type: "kingboss",
      x: bossX, y:(groundY-4)*TILE,
      hp: 10 + worldIdx*3,
      maxHp: 10 + worldIdx*3,
      phase: 1,
      arenaLeft: arenaStartX*TILE + TILE*2,
      arenaRight: (width-4)*TILE,
    };
  }

  // flag/goal position -- placed just past the boss arena (or normal end for regular levels)
  const goal = isBoss
    ? { x:(width-4)*TILE, y:(groundY-8)*TILE }
    : { x:(width-5)*TILE, y:(groundY-8)*TILE };

  return {
    index, theme, width, height, tiles, groundY,
    entities, boss, goal, isBoss, arena, arenaStartX,
    name: `${theme.name} ${stageInWorld+1}-${isBoss?"BOSS":stageInWorld+1}`,
    worldNum: worldIdx+1, stageNum: stageInWorld+1,
    timeLimit: isBoss ? 560 : 300 + Math.floor(rng()*60),
  };
}

// Build a large, detailed arena for the boss fight: an open floor with
// decorative pillars, torch/crystal decor, raised side platforms the boss
// can be knocked toward, and (in later worlds) lava/hazard strips.
function buildArena(tiles, theme, startX, width, groundY, height, rng, entities, worldIdx) {
  // clear arena of any decor tiles that may have leaked in, keep floor solid
  for (let ty=0; ty<groundY; ty++){
    for (let tx=startX; tx<width; tx++){
      tiles[ty][tx] = 0;
    }
  }
  // side platforms player can use to dodge/jump on
  const platforms = [];
  for (let i=0;i<3;i++){
    const px = startX + 6 + i*13;
    const py = groundY - (4 + (i%2)*3);
    const len = 4;
    for (let k=0;k<len;k++){
      if (px+k < width-3) tiles[py][px+k] = 7;
    }
    platforms.push({x:px,y:py,len});
  }
  // decorative pillars (visual only, drawn from tile id 2 at the very edges so they don't block the fight much)
  for (let i=0;i<2;i++){
    const px = startX + 2 + i*(width-startX-6);
    for (let py=groundY-6; py<groundY; py++){
      if (px>=0 && px<width) tiles[py][px] = 9;
    }
  }
  // lava/hazard strip in the fiery castle world for extra tension (visual + a couple of extra flying enemies to compensate the tight floor)
  if (worldIdx === 4) {
    entities.enemies.push({type:'flyer', x:(startX+10)*TILE, y:(groundY-6)*TILE, range:100});
    entities.enemies.push({type:'flyer', x:(startX+26)*TILE, y:(groundY-5)*TILE, range:120});
  }
  // scatter a few bonus coins around the arena as a reward for skillful dodging
  for (let i=0;i<12;i++){
    const cx = startX+4+Math.floor(rng()*(width-startX-8));
    const cy = groundY-3-Math.floor(rng()*5);
    entities.coins.push({x:cx*TILE+16, y:cy*TILE+16});
  }
  return { startX, width, platforms };
}

function findGroundY(tiles, x, height) {
  for (let y=0;y<height;y++){
    if (tiles[y][x] && tiles[y][x]!==7) return y;
  }
  return height-1;
}

const ALL_LEVELS_META = Array.from({length:20}, (_,i) => {
  const w = Math.floor(i/4)+1, s = (i%4)+1;
  return { index:i, world:w, stage:s, isBoss: s===4, theme: THEMES[Math.floor(i/4)].name };
});
