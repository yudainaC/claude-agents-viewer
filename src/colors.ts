export const COLORS: Record<string, string> = {
  cyan: "#3fb6c6",
  blue: "#5b84d6",
  purple: "#9b6fd3",
  green: "#4caf7a",
  yellow: "#d9a93a",
  red: "#d9604f",
  orange: "#d97757",
  pink: "#d76a9e",
};

/** Couleur de l'écharpe d'un agent : celle de sa définition, sinon une couleur stable tirée de son nom. */
export function agentColor(name: string, color?: string) {
  if (name === "principal") return "#f2efe6";
  if (color && COLORS[color]) return COLORS[color];
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return color;
  const known: Record<string, string> = { eclaireur: COLORS.cyan, documentaliste: COLORS.blue, architecte: COLORS.purple, developpeur: COLORS.green, testeur: COLORS.yellow, relecteur: COLORS.red, Explore: COLORS.cyan, "general-purpose": COLORS.pink };
  if (known[name]) return known[name];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  const pool = Object.values(COLORS);
  return pool[Math.abs(h) % pool.length];
}
