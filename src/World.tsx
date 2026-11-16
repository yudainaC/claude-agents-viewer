import { useEffect, useRef, useState } from "react";

// Le « studio » : un petit monde animé dessiné sur un canvas.
// Chaque agent est un personnage. Il dort dans le coin repos quand il n'a rien
// à faire, marche jusqu'à un bureau quand on lui confie une tâche, tape sur son
// clavier pendant qu'il travaille, et les visiteurs entrent et sortent par la porte.
// La pièce passe du jour à la nuit selon qu'il y a du travail ou non.

export interface Actor {
  id: string;
  name: string;
  color: string;
  working: boolean;
  /** Ce qu'il fait (outil en cours), affiché dans une bulle */
  tool?: string;
  /** Texte de l'infobulle */
  label?: string;
  /** Les visiteurs entrent et sortent par la porte */
  visitor?: boolean;
}

const W = 800;
const H = 560;
const FLOOR = 330;
const DOOR_X = 70;

type Pose = "walk" | "sleep" | "work" | "idle";

interface Sprite {
  actor: Actor;
  x: number;
  y: number;
  tx: number;
  ty: number;
  pose: Pose;
  alpha: number;
  leaving: boolean;
  phase: number;
  bed: number;
  desk: number;
  facing: 1 | -1;
}

interface Particle {
  kind: "z" | "glyph" | "dust" | "spark";
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  text?: string;
  color?: string;
  size: number;
}

const GLYPHS = ["{", "}", "<", "/>", "( )", ";", "=>", "#", "fn", "01"];

function bedSlot(i: number) {
  const col = i % 3;
  const row = Math.floor(i / 3) % 3;
  return { x: 150 + col * 94 + (row % 2) * 24, y: 392 + row * 66 };
}
function deskSlot(i: number) {
  const col = i % 3;
  const row = Math.floor(i / 3) % 2;
  return { x: 455 + col * 112 + Math.floor(i / 6) * 14, y: 405 + row * 92 };
}
/** Position des pieds du personnage assis devant son bureau */
const seat = (i: number) => {
  const d = deskSlot(i);
  return { x: d.x + 6, y: d.y };
};
/** Position du personnage couché (tête sur l'oreiller) */
const pillow = (i: number) => {
  const b = bedSlot(i);
  return { x: b.x - 22, y: b.y - 6 };
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function mix(c1: string, c2: string, t: number) {
  const p = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const a = p(c1);
  const b = p(c2);
  return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(",")})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Plafond de pixels du canvas (≈ 1600×1000) et cadence de l'animation. */
const MAX_PIXELS = 1_600_000;
const FRAME_MS = 1000 / 30;

export function World({
  actors,
  height,
  compact = false,
  onPick,
}: {
  actors: Actor[];
  height?: number;
  compact?: boolean;
  onPick?: (a: Actor) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const actorsRef = useRef(actors);
  actorsRef.current = actors;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [tip, setTip] = useState<{ x: number; y: number; a: Actor } | null>(null);
  const hoverRef = useRef<string | null>(null);

  useEffect(() => {
    const cv = canvas.current!;
    const main = cv.getContext("2d")!;
    // `ctx` pointe sur le canvas visible, ou sur un calque en cache pendant qu'on le prépare
    let ctx = main;
    // calques mis en cache : le décor fixe et la vignette ne sont redessinés que
    // si la taille change ou si la lumière (jour/nuit) a vraiment bougé
    const bg = document.createElement("canvas");
    const vig = document.createElement("canvas");
    let bgKey = "";
    let vigKey = "";
    let transform: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    const sprites = new Map<string, Sprite>();
    const particles: Particle[] = [];
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let first = true;
    let day = 0;
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let scale = 1;
    let offX = 0;
    let offY = 0;

    const resize = () => {
      const r = cv.getBoundingClientRect();
      // résolution plafonnée : au-delà, l'œil ne voit pas la différence mais le
      // processeur si (WebKitGTK, utilisé par Tauri sous Linux, dessine souvent sans GPU)
      let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const area = Math.max(1, r.width * r.height);
      if (area * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / area);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      bg.width = vig.width = cv.width;
      bg.height = vig.height = cv.height;
      bgKey = vigKey = "";
      // on remplit la largeur, et on cadre sur le sol si la hauteur manque
      scale = Math.max(r.width / W, r.height / H);
      // en petit format on zoome sur le sol (lits et bureaux), centré sur la pièce
      offX = compact ? r.width / 2 - 448 * scale : (r.width - W * scale) / 2;
      offY = Math.min(0, r.height - H * scale);
      transform = [dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY];
      main.setTransform(...transform);
    };

    /** Dessine `paint` dans un calque hors écran (même repère que le canvas visible). */
    const renderLayer = (layer: HTMLCanvasElement, paint: () => void) => {
      const lc = layer.getContext("2d")!;
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.clearRect(0, 0, layer.width, layer.height);
      lc.setTransform(...transform);
      ctx = lc;
      paint();
      ctx = main;
    };
    const blit = (layer: HTMLCanvasElement) => {
      main.save();
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.drawImage(layer, 0, 0);
      main.restore();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    resize();

    for (let i = 0; i < (reduced ? 6 : 26); i++) {
      particles.push({ kind: "dust", x: 280 + Math.random() * 260, y: 80 + Math.random() * 400, vx: (Math.random() - 0.5) * 4, vy: -2 - Math.random() * 4, life: Math.random() * 10, max: 10, size: 1 + Math.random() * 1.5 });
    }

    // --------------------------------------------------- réconciliation acteurs → sprites
    const reconcile = () => {
      const list = actorsRef.current;
      const ids = new Set(list.map((a) => a.id));
      const usedBeds = new Set<number>();
      const usedDesks = new Set<number>();
      for (const s of sprites.values()) {
        if (s.leaving) continue;
        usedBeds.add(s.bed);
        if (s.desk >= 0) usedDesks.add(s.desk);
      }
      const free = (used: Set<number>) => {
        let i = 0;
        while (used.has(i)) i++;
        used.add(i);
        return i;
      };
      for (const a of list) {
        let s = sprites.get(a.id);
        if (!s) {
          const bed = free(usedBeds);
          const desk = a.working ? free(usedDesks) : -1;
          const start = first ? (a.working ? seat(desk) : pillow(bed)) : { x: DOOR_X, y: FLOOR + 30 };
          s = { actor: a, x: start.x, y: start.y, tx: start.x, ty: start.y, pose: first ? (a.working ? "work" : "sleep") : "walk", alpha: first ? 1 : 0, leaving: false, phase: Math.random() * 10, bed, desk, facing: 1 };
          sprites.set(a.id, s);
        }
        const wasWorking = s.actor.working;
        s.actor = a;
        // un bureau n'est attribué que pendant le travail, puis libéré
        if (a.working && s.desk < 0) s.desk = free(usedDesks);
        if (!a.working && s.desk >= 0) {
          usedDesks.delete(s.desk);
          s.desk = -1;
        }
        const target = a.working ? seat(s.desk) : pillow(s.bed);
        s.tx = target.x;
        s.ty = target.y;
        if (wasWorking && !a.working) burst(s.x, s.y - 40, "#7fe0b5");
      }
      for (const s of sprites.values()) {
        if (!ids.has(s.actor.id) && !s.leaving) {
          s.leaving = true;
          s.desk = -1;
          s.tx = DOOR_X;
          s.ty = FLOOR + 30;
          burst(s.x, s.y - 40, "#f0c27e");
        }
      }
      first = false;
    };

    const burst = (x: number, y: number, color: string) => {
      if (reduced) return;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        particles.push({ kind: "spark", x, y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40 - 10, life: 0, max: 0.8, color, size: 2.2 });
      }
    };

    // --------------------------------------------------- décor
    // décor fixe (mis en cache)
    const drawRoomStatic = () => {
      const wall = mix("#2a2430", "#f1e4cf", day);
      const wall2 = mix("#221d27", "#e6d5bb", day);
      const g = ctx.createLinearGradient(0, 0, 0, FLOOR);
      g.addColorStop(0, wall2);
      g.addColorStop(1, wall);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, FLOOR);

      // papier peint discret
      ctx.fillStyle = `rgba(255,255,255,${0.03 + day * 0.05})`;
      for (let x = 20; x < W; x += 40) for (let y = 24; y < FLOOR - 20; y += 40) ctx.fillRect(x, y, 2, 2);

      // sol en lattes
      const fg = ctx.createLinearGradient(0, FLOOR, 0, H);
      fg.addColorStop(0, mix("#3b2f2a", "#d9b98f", day));
      fg.addColorStop(1, mix("#2c231f", "#c49d72", day));
      ctx.fillStyle = fg;
      ctx.fillRect(0, FLOOR, W, H - FLOOR);
      ctx.strokeStyle = `rgba(0,0,0,${0.12 - day * 0.04})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const y = FLOOR + 8 + i * i * 3.2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.fillStyle = mix("#4a3a33", "#b88f62", day);
      ctx.fillRect(0, FLOOR - 6, W, 8);

      // tapis du coin repos
      ctx.fillStyle = mix("#3d3350", "#e9c6b0", day);
      ctx.beginPath();
      ctx.ellipse(245, 470, 165, 58, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.08 + day * 0.15})`;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.ellipse(245, 470, 150, 48, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // rayon de lumière (jour) ou de lune (nuit)
      const wx = 300;
      const wy = 46;
      const ww = 200;
      const wh = 150;
      const beam = ctx.createLinearGradient(wx, wy + wh, wx + 60, H);
      beam.addColorStop(0, day > 0.5 ? `rgba(255,236,190,${0.18 * day})` : `rgba(170,190,255,${0.08 * (1 - day)})`);
      beam.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(wx + 10, wy + wh);
      ctx.lineTo(wx + ww - 10, wy + wh);
      ctx.lineTo(wx + ww + 90, H);
      ctx.lineTo(wx + 40, H);
      ctx.fill();

      // porte
      ctx.fillStyle = mix("#3d2f28", "#9c6d45", day);
      roundRect(ctx, DOOR_X - 38, 186, 76, FLOOR - 186, 6);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.2)";
      ctx.lineWidth = 2;
      ctx.strokeRect(DOOR_X - 28, 200, 56, 50);
      ctx.strokeRect(DOOR_X - 28, 262, 56, 52);
      ctx.fillStyle = "#e7c36a";
      ctx.beginPath();
      ctx.arc(DOOR_X + 26, 262, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // panneau
      ctx.fillStyle = mix("#e9dcc6", "#fffaf1", day);
      roundRect(ctx, DOOR_X - 24, 160, 48, 16, 4);
      ctx.fill();
      ctx.fillStyle = "#7a5a3c";
      ctx.font = "700 9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("STUDIO", DOOR_X, 171);

      // étagère et plantes
      ctx.fillStyle = mix("#5b4636", "#a87b52", day);
      ctx.fillRect(560, 120, 180, 7);
      const books = ["#d9604f", "#5b84d6", "#d9a93a", "#4caf7a", "#9b6fd3", "#3fb6c6"];
      books.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.55 + day * 0.45;
        ctx.fillRect(572 + i * 13, 90 + (i % 2) * 6, 10, 30 - (i % 2) * 6);
      });
      ctx.globalAlpha = 1;
      // horloge
      const cx = 640;
      const cy = 205;
      ctx.fillStyle = mix("#e9dcc6", "#fffaf1", day);
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = mix("#5b4636", "#a87b52", day);
      ctx.lineWidth = 3;
      ctx.stroke();
    };

    // décor animé : ciel, plantes, aiguilles
    const drawRoomLive = () => {
      // fenêtre et ciel
      const wx = 300;
      const wy = 46;
      const ww = 200;
      const wh = 150;
      const sky = ctx.createLinearGradient(0, wy, 0, wy + wh);
      sky.addColorStop(0, mix("#0e1430", "#7cc3f0", day));
      sky.addColorStop(1, mix("#2a2f5e", "#cfeafb", day));
      ctx.fillStyle = sky;
      ctx.fillRect(wx, wy, ww, wh);
      ctx.save();
      ctx.beginPath();
      ctx.rect(wx, wy, ww, wh);
      ctx.clip();
      // étoiles
      ctx.globalAlpha = 1 - day;
      for (let i = 0; i < 26; i++) {
        const sx = wx + ((i * 73) % ww);
        const sy = wy + ((i * 41) % (wh - 30));
        ctx.globalAlpha = (1 - day) * (0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + i)));
        ctx.fillStyle = "#fff";
        ctx.fillRect(sx, sy, 1.6, 1.6);
      }
      // lune / soleil
      ctx.globalAlpha = 1 - day;
      ctx.fillStyle = "#f4e7b0";
      ctx.beginPath();
      ctx.arc(wx + 150, wy + 40, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mix("#0e1430", "#7cc3f0", day);
      ctx.beginPath();
      ctx.arc(wx + 158, wy + 35, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = day;
      ctx.fillStyle = "#ffd56b";
      ctx.beginPath();
      ctx.arc(wx + 50, wy + 42 + (1 - day) * 40, 15, 0, Math.PI * 2);
      ctx.fill();
      // nuages qui défilent
      ctx.globalAlpha = 0.25 + day * 0.65;
      ctx.fillStyle = mix("#59607f", "#ffffff", day);
      for (let i = 0; i < 3; i++) {
        const cx = wx + ((t * (8 + i * 4) + i * 90) % (ww + 120)) - 60;
        const cy = wy + 70 + i * 22;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 26, 9, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 16, cy - 6, 16, 9, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - 14, cy - 3, 13, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // collines lointaines
      ctx.globalAlpha = 1;
      ctx.fillStyle = mix("#141a35", "#8fc59b", day);
      ctx.beginPath();
      ctx.moveTo(wx, wy + wh);
      for (let x = 0; x <= ww; x += 10) ctx.lineTo(wx + x, wy + wh - 22 - Math.sin(x / 30) * 8 - Math.sin(x / 13) * 3);
      ctx.lineTo(wx + ww, wy + wh);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      // cadre
      ctx.strokeStyle = mix("#5b4636", "#a87b52", day);
      ctx.lineWidth = 8;
      ctx.strokeRect(wx, wy, ww, wh);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(wx + ww / 2, wy);
      ctx.lineTo(wx + ww / 2, wy + wh);
      ctx.moveTo(wx, wy + wh / 2);
      ctx.lineTo(wx + ww, wy + wh / 2);
      ctx.stroke();
      ctx.fillStyle = mix("#5b4636", "#a87b52", day);
      ctx.fillRect(wx - 12, wy + wh + 2, ww + 24, 8);

      plant(700, 120, 0.8);
      plant(760, FLOOR + 10, 1.25);
      plant(140, FLOOR + 6, 1);

      const cx = 640;
      const cy = 205;
      const now = new Date();
      const hand = (ang: number, len: number, w: number) => {
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.sin(ang) * len, cy - Math.cos(ang) * len);
        ctx.stroke();
      };
      ctx.strokeStyle = "#3a2e26";
      ctx.lineCap = "round";
      hand(((now.getHours() % 12) + now.getMinutes() / 60) * (Math.PI / 6), 10, 2.5);
      hand(now.getMinutes() * (Math.PI / 30), 15, 1.8);
      ctx.strokeStyle = "#d97757";
      hand(now.getSeconds() * (Math.PI / 30), 16, 1);
      ctx.lineCap = "butt";
    };

    const plant = (x: number, y: number, s: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.fillStyle = mix("#7a4a35", "#c66b4b", day);
      roundRect(ctx, -10, -18, 20, 18, 3);
      ctx.fill();
      ctx.fillStyle = mix("#2e5a44", "#5aa86f", day);
      for (let i = 0; i < 5; i++) {
        const sway = Math.sin(t * 1.2 + i + x) * 0.12;
        ctx.save();
        ctx.translate(0, -18);
        ctx.rotate(-0.9 + i * 0.45 + sway);
        ctx.beginPath();
        ctx.ellipse(0, -14, 5, 14, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    };

    // --------------------------------------------------- mobilier par emplacement
    const drawBed = (i: number, occupied: Sprite | undefined) => {
      const { x, y } = bedSlot(i);
      ctx.fillStyle = "rgba(0,0,0,.15)";
      ctx.beginPath();
      ctx.ellipse(x, y + 12, 46, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mix("#6b4f3a", "#b98b5e", day);
      roundRect(ctx, x - 44, y - 6, 88, 18, 5);
      ctx.fill();
      roundRect(ctx, x - 48, y - 30, 9, 40, 3);
      ctx.fill();
      ctx.fillStyle = mix("#cfc6b8", "#f6f1e8", day);
      roundRect(ctx, x - 40, y - 14, 82, 12, 5);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.6 + day * 0.4;
      ctx.beginPath();
      ctx.ellipse(x - 24, y - 15, 13, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (!occupied || occupied.pose !== "sleep") {
        // couverture pliée
        ctx.fillStyle = occupied ? occupied.actor.color : mix("#5a5368", "#c9bfb1", day);
        ctx.globalAlpha = 0.8;
        roundRect(ctx, x + 6, y - 18, 34, 10, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    };

    const drawDesk = (i: number, s: Sprite | undefined) => {
      const { x, y } = deskSlot(i);
      const on = s?.pose === "work";
      ctx.fillStyle = "rgba(0,0,0,.15)";
      ctx.beginPath();
      ctx.ellipse(x + 30, y + 6, 50, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      // lampe : halo
      if (on) {
        const halo = ctx.createRadialGradient(x + 62, y - 40, 2, x + 62, y - 40, 70);
        halo.addColorStop(0, `rgba(255,224,150,${0.35 - day * 0.2})`);
        halo.addColorStop(1, "rgba(255,224,150,0)");
        ctx.fillStyle = halo;
        ctx.fillRect(x - 10, y - 110, 150, 130);
      }
      // pieds et plateau
      ctx.fillStyle = mix("#4e3a2c", "#94693f", day);
      ctx.fillRect(x + 2, y - 30, 4, 32);
      ctx.fillRect(x + 66, y - 30, 4, 32);
      ctx.fillStyle = mix("#6b4f3a", "#b98b5e", day);
      roundRect(ctx, x - 6, y - 36, 84, 7, 2);
      ctx.fill();
      // écran
      ctx.fillStyle = "#26252a";
      ctx.fillRect(x + 36, y - 44, 6, 9);
      roundRect(ctx, x + 18, y - 76, 44, 32, 3);
      ctx.fill();
      const scr = on ? ctx.createLinearGradient(x + 21, y - 73, x + 59, y - 47) : null;
      if (scr) {
        scr.addColorStop(0, "#1f4d40");
        scr.addColorStop(1, "#173a4d");
      }
      ctx.fillStyle = scr ?? "#141417";
      ctx.fillRect(x + 21, y - 73, 38, 26);
      if (on) {
        // lignes de code qui défilent
        for (let l = 0; l < 4; l++) {
          const w = 8 + ((Math.floor(t * 3) + l * 7 + i) % 5) * 5;
          ctx.fillStyle = ["#7fe0b5", "#f0b37e", "#8fb4ff", "#7fe0b5"][l];
          ctx.fillRect(x + 24 + (l % 2) * 4, y - 70 + l * 6, w, 2);
        }
        if (Math.floor(t * 2) % 2) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(x + 50, y - 52, 3, 3);
        }
      } else {
        ctx.fillStyle = "#e0ac4a";
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2);
        ctx.fillRect(x + 54, y - 49, 2, 2);
        ctx.globalAlpha = 1;
      }
      // clavier
      ctx.fillStyle = on ? "#6b675f" : "#55524c";
      roundRect(ctx, x + 10, y - 40, 26, 4, 1.5);
      ctx.fill();
      // lampe
      ctx.fillStyle = "#8d8a84";
      ctx.fillRect(x + 66, y - 58, 2, 22);
      ctx.fillStyle = s ? s.actor.color : mix("#5a5368", "#c9bfb1", day);
      ctx.beginPath();
      ctx.moveTo(x + 58, y - 58);
      ctx.lineTo(x + 76, y - 58);
      ctx.lineTo(x + 72, y - 68);
      ctx.lineTo(x + 62, y - 68);
      ctx.fill();
      // chaise
      ctx.fillStyle = s ? s.actor.color : mix("#5a5368", "#c9bfb1", day);
      ctx.globalAlpha = 0.9;
      roundRect(ctx, x - 22, y - 22, 28, 6, 3);
      ctx.fill();
      roundRect(ctx, x - 26, y - 48, 6, 32, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#8d8a84";
      ctx.fillRect(x - 10, y - 16, 3, 14);
      ctx.fillRect(x - 18, y - 3, 19, 2);
    };

    // --------------------------------------------------- personnage
    const drawCritter = (s: Sprite) => {
      const a = s.actor;
      const size = 34;
      ctx.save();
      ctx.globalAlpha = s.alpha;
      let x = s.x;
      let y = s.y;
      const walking = s.pose === "walk";
      const sleeping = s.pose === "sleep";
      const working = s.pose === "work";
      const bob = walking ? Math.abs(Math.sin(s.phase * 9)) * 4 : working ? Math.sin(s.phase * 6) * 0.8 : Math.sin(s.phase * 2) * 0.8;
      const squash = walking ? 1 + Math.sin(s.phase * 18) * 0.04 : sleeping ? 1 + Math.sin(s.phase * 1.6) * 0.04 : 1;

      if (!sleeping) {
        // ombre
        ctx.fillStyle = "rgba(0,0,0,.18)";
        ctx.beginPath();
        ctx.ellipse(x, y + 1, 14, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (working) y -= 14; // assis sur la chaise
      ctx.translate(x, y - bob);
      if (sleeping) ctx.rotate(-0.08);
      ctx.scale(s.facing * (2 - squash), squash);

      // pieds
      if (walking) {
        const k = Math.sin(s.phase * 9);
        ctx.fillStyle = "#b9583c";
        ctx.beginPath();
        ctx.ellipse(-6 + k * 3, -1, 5, 3, 0, 0, Math.PI * 2);
        ctx.ellipse(6 - k * 3, -1, 5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // corps
      const body = ctx.createLinearGradient(0, -size, 0, 0);
      body.addColorStop(0, "#e88a69");
      body.addColorStop(1, "#cf6a4a");
      ctx.fillStyle = body;
      roundRect(ctx, -size / 2, -size - 2, size, size, 13);
      ctx.fill();
      // reflet
      ctx.fillStyle = "rgba(255,255,255,.22)";
      ctx.beginPath();
      ctx.ellipse(-7, -size + 6, 6, 3.5, -0.4, 0, Math.PI * 2);
      ctx.fill();
      // écharpe à la couleur de l'agent
      ctx.fillStyle = a.color;
      roundRect(ctx, -size / 2 + 1, -12, size - 2, 6, 3);
      ctx.fill();
      ctx.fillRect(size / 2 - 9, -8, 5, 9 + (walking ? Math.sin(s.phase * 9) * 2 : 0));

      // visage
      const look = working ? 4 : 0;
      ctx.fillStyle = "#2a1d17";
      if (sleeping) {
        ctx.strokeStyle = "#2a1d17";
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(-6, -21, 3, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.moveTo(9, -21);
        ctx.arc(6, -21, 3, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      } else {
        const blink = Math.sin(s.phase * 0.9 + 1) > 0.985 ? 0.2 : 1;
        roundRect(ctx, -8 + look, -25, 3.6, 6.5 * blink, 1.8);
        ctx.fill();
        roundRect(ctx, 4 + look, -25, 3.6, 6.5 * blink, 1.8);
        ctx.fill();
        ctx.strokeStyle = "#2a1d17";
        ctx.lineWidth = 1.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(look, -16, 2.6, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,150,130,.55)";
      ctx.beginPath();
      ctx.ellipse(-11, -15, 3, 1.8, 0, 0, Math.PI * 2);
      ctx.ellipse(11, -15, 3, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();

      // étincelle sur la tête
      ctx.save();
      ctx.translate(0, -size - 6);
      ctx.rotate(s.phase * (working ? 3 : 0.6));
      ctx.fillStyle = working ? "#ffd56b" : "#e88a69";
      for (let k = 0; k < 4; k++) {
        ctx.rotate(Math.PI / 4);
        roundRect(ctx, -1.3, -6, 2.6, 12, 1.3);
        ctx.fill();
      }
      ctx.restore();

      // bras qui tapent
      if (working) {
        ctx.fillStyle = "#d9714f";
        const tap = Math.sin(s.phase * 22) * 1.5;
        roundRect(ctx, size / 2 - 4, -12 + tap, 14, 4, 2);
        ctx.fill();
        roundRect(ctx, size / 2 - 6, -8 - tap, 14, 4, 2);
        ctx.fill();
      }
      ctx.restore();

      // couverture par-dessus le dormeur
      if (sleeping) {
        const b = bedSlot(s.bed);
        ctx.save();
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = a.color;
        ctx.beginPath();
        ctx.moveTo(b.x - 14, b.y - 16);
        ctx.quadraticCurveTo(b.x + 12, b.y - 30 - Math.sin(s.phase * 1.6) * 1.5, b.x + 42, b.y - 16);
        ctx.lineTo(b.x + 42, b.y + 2);
        ctx.lineTo(b.x - 14, b.y + 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.3)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x - 12, b.y - 14);
        ctx.quadraticCurveTo(b.x + 12, b.y - 27, b.x + 40, b.y - 14);
        ctx.stroke();
        ctx.restore();
      }
    };

    const drawLabels = (s: Sprite) => {
      const a = s.actor;
      const sleeping = s.pose === "sleep";
      const working = s.pose === "work";
      if (!compact || hoverRef.current === a.id) {
        ctx.save();
        ctx.globalAlpha = s.alpha * (sleeping ? 0.75 : 1);
        ctx.font = "600 10.5px ui-monospace, Menlo, monospace";
        ctx.textAlign = "center";
        const label = a.name;
        const tw = ctx.measureText(label).width + 12;
        const ly = sleeping ? s.y + 26 : s.y + 16;
        ctx.fillStyle = "rgba(20,18,16,.62)";
        roundRect(ctx, s.x - tw / 2, ly - 10, tw, 15, 7);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(label, s.x, ly + 1);
        ctx.restore();
      }

      // bulle de l'outil
      if (working && a.tool) {
        ctx.save();
        ctx.globalAlpha = s.alpha;
        const by = s.y - 78 + Math.sin(t * 2 + s.phase) * 2;
        ctx.font = "600 10px ui-monospace, Menlo, monospace";
        const text = a.tool + "…";
        const bw = ctx.measureText(text).width + 16;
        ctx.fillStyle = "#fffaf1";
        roundRect(ctx, s.x - bw / 2, by - 12, bw, 18, 9);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(s.x - 3, by + 6);
        ctx.lineTo(s.x + 4, by + 6);
        ctx.lineTo(s.x, by + 11);
        ctx.fill();
        ctx.fillStyle = "#3a2e26";
        ctx.textAlign = "center";
        ctx.fillText(text, s.x, by + 1);
        ctx.restore();
      }
    };


    // --------------------------------------------------- boucle
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      reconcile();

      const anyWorking = [...sprites.values()].some((s) => s.actor.working && !s.leaving);
      day += ((anyWorking ? 1 : 0) - day) * Math.min(1, dt * 1.2);

      // mouvements
      for (const s of [...sprites.values()]) {
        s.phase += dt;
        const dx = s.tx - s.x;
        const dy = s.ty - s.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 2) {
          const sp = Math.min(dist, 110 * dt);
          s.x += (dx / dist) * sp;
          s.y += (dy / dist) * sp;
          s.pose = "walk";
          if (Math.abs(dx) > 1) s.facing = dx > 0 ? 1 : -1;
        } else {
          s.x = s.tx;
          s.y = s.ty;
          if (s.leaving) {
            s.alpha -= dt * 2;
            if (s.alpha <= 0) sprites.delete(s.actor.id);
            continue;
          }
          const was = s.pose;
          s.pose = s.actor.working ? "work" : "sleep";
          s.facing = 1;
          if (was === "walk" && s.pose === "work") burst(s.x + 20, s.y - 50, "#ffd56b");
        }
        if (!s.leaving) s.alpha = Math.min(1, s.alpha + dt * 2);

        // particules émises
        if (!reduced) {
          if (s.pose === "sleep" && Math.random() < dt * 0.7) {
            particles.push({ kind: "z", x: s.x + 6, y: s.y - 30, vx: 6, vy: -12, life: 0, max: 2.6, text: Math.random() < 0.5 ? "z" : "Z", size: 9 + Math.random() * 5 });
          }
          if (s.pose === "work" && s.desk >= 0 && Math.random() < dt * 2.2) {
            const d = deskSlot(s.desk);
            particles.push({ kind: "glyph", x: d.x + 40 + (Math.random() - 0.5) * 20, y: d.y - 78, vx: (Math.random() - 0.5) * 10, vy: -18 - Math.random() * 10, life: 0, max: 1.8, text: GLYPHS[Math.floor(Math.random() * GLYPHS.length)], color: ["#7fe0b5", "#f0b37e", "#8fb4ff"][Math.floor(Math.random() * 3)], size: 9 + Math.random() * 3 });
          }
        }
      }

      // dessin
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.restore();
      const dayKey = `${cv.width}x${cv.height}:${Math.round(day * 40)}`;
      if (dayKey !== bgKey) {
        renderLayer(bg, drawRoomStatic);
        bgKey = dayKey;
      }
      blit(bg);
      drawRoomLive();

      // profondeur : meubles et personnages triés par y
      const byBed = new Map<number, Sprite>();
      const byDesk = new Map<number, Sprite>();
      let maxBed = 2;
      let maxDesk = 5;
      for (const s of sprites.values()) {
        if (s.leaving) continue;
        byBed.set(s.bed, s);
        if (s.desk >= 0) byDesk.set(s.desk, s);
        maxBed = Math.max(maxBed, s.bed);
        maxDesk = Math.max(maxDesk, s.desk);
      }
      type D = { y: number; draw: () => void };
      const items: D[] = [];
      for (let i = 0; i <= maxBed; i++) items.push({ y: bedSlot(i).y - 1, draw: () => drawBed(i, byBed.get(i)) });
      for (let i = 0; i <= maxDesk; i++) items.push({ y: deskSlot(i).y - 1, draw: () => drawDesk(i, byDesk.get(i)) });
      for (const s of sprites.values()) items.push({ y: s.pose === "sleep" ? bedSlot(s.bed).y : s.pose === "work" && s.desk >= 0 ? deskSlot(s.desk).y - 0.5 : s.y, draw: () => drawCritter(s) });
      items.sort((a, b) => a.y - b.y);
      for (const it of items) it.draw();

      // particules
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.kind === "dust") {
          p.x += p.vx * dt + Math.sin(t + i) * 0.1;
          p.y += p.vy * dt;
          if (p.y < 60) {
            p.y = 480;
            p.x = 280 + Math.random() * 260;
          }
          ctx.fillStyle = `rgba(255,240,200,${0.15 + day * 0.35})`;
          ctx.fillRect(p.x, p.y, p.size, p.size);
          continue;
        }
        if (p.life > p.max) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const k = 1 - p.life / p.max;
        if (p.kind === "spark") {
          p.vy += 60 * dt;
          ctx.fillStyle = p.color!;
          ctx.globalAlpha = k;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * k + 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.globalAlpha = Math.min(1, k * 1.5) * (p.kind === "z" ? 0.8 : 0.9);
          ctx.fillStyle = p.kind === "z" ? mix("#b8b0d8", "#7a6f8a", day) : p.color!;
          ctx.font = `${p.kind === "z" ? 700 : 600} ${p.size}px ${p.kind === "z" ? "system-ui, sans-serif" : "ui-monospace, Menlo, monospace"}`;
          ctx.textAlign = "center";
          ctx.fillText(p.text!, p.x + (p.kind === "z" ? Math.sin(p.life * 3) * 4 : 0), p.y);
        }
        ctx.globalAlpha = 1;
      }

      // noms et bulles par-dessus tout le reste
      for (const s of sprites.values()) drawLabels(s);

      // vignette douce
      if (dayKey !== vigKey) {
        renderLayer(vig, () => {
          const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
          vg.addColorStop(0, "rgba(0,0,0,0)");
          vg.addColorStop(1, `rgba(0,0,0,${0.35 - day * 0.2})`);
          ctx.fillStyle = vg;
          ctx.fillRect(0, 0, W, H);
        });
        vigKey = dayKey;
      }
      blit(vig);
    };

    // boucle à ~30 images/s, en pause quand le studio n'est pas visible
    let visible = true;
    let lastDraw = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) {
        last = now;
        return;
      }
      if (now - lastDraw < FRAME_MS - 2) return;
      lastDraw = now;
      frame(now);
    };
    raf = requestAnimationFrame(loop);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(cv);

    // survol et clic
    const toLogical = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left - offX) / scale, y: (e.clientY - r.top - offY) / scale, px: e.clientX - r.left, py: e.clientY - r.top };
    };
    const hit = (e: MouseEvent) => {
      const p = toLogical(e);
      let best: Sprite | null = null;
      let bd = 30;
      for (const s of sprites.values()) {
        const cy = s.pose === "work" ? s.y - 30 : s.y - 18;
        const d = Math.hypot(p.x - s.x, p.y - cy);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return { s: best, p };
    };
    const onMove = (e: MouseEvent) => {
      const { s, p } = hit(e);
      hoverRef.current = s?.actor.id ?? null;
      cv.style.cursor = s && pickRef.current ? "pointer" : "default";
      setTip(s ? { x: p.px, y: p.py, a: s.actor } : null);
    };
    const onLeave = () => {
      hoverRef.current = null;
      setTip(null);
    };
    const onClick = (e: MouseEvent) => {
      const { s } = hit(e);
      if (s && pickRef.current) pickRef.current(s.actor);
    };
    cv.addEventListener("mousemove", onMove);
    cv.addEventListener("mouseleave", onLeave);
    cv.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      cv.removeEventListener("mousemove", onMove);
      cv.removeEventListener("mouseleave", onLeave);
      cv.removeEventListener("click", onClick);
    };
  }, [compact]);

  return (
    <div className="world" ref={wrap} style={height ? { height } : { aspectRatio: `${W} / ${H}` }}>
      <canvas ref={canvas} className="world-canvas" aria-label="Le studio : les agents dorment ou travaillent à leur bureau" role="img" />
      {tip && (
        <div className="world-tip" style={{ left: Math.min(tip.x + 14, (wrap.current?.clientWidth ?? 300) - 220), top: Math.max(4, tip.y - 10) }}>
          <b>{tip.a.name}</b>
          <span>{tip.a.working ? `au travail${tip.a.tool ? ` · ${tip.a.tool}` : ""}` : "dort"}</span>
          {tip.a.label && <em>{tip.a.label}</em>}
        </div>
      )}
    </div>
  );
}
