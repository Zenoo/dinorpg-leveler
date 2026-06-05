import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import fs from "fs";
import path from "path";

const API      = "https://dinorpg.eternaltwin.org/api/v1";
const SAVE_FILE = path.join(import.meta.dirname, ".dinoz-credentials.json");

// ── Colours ─────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  dim:    "\x1b[2m",
};

const ts   = () => new Date().toLocaleTimeString("fr-FR");
const log  = (msg: string) => console.log(`${C.cyan}[${ts()}]${C.reset} ${msg}`);
const ok   = (msg: string) => console.log(`${C.green}[${ts()}] ✓${C.reset} ${msg}`);
const warn = (msg: string) => console.log(`${C.yellow}[${ts()}] ⚠${C.reset} ${msg}`);

// ── Saved credentials ────────────────────────────────────────
type Credentials = { user?: string; token?: string; dinozId?: number; };

const loadCredentials = (): Credentials | null => {
  try {
    const raw = fs.readFileSync(SAVE_FILE, "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

const saveCredentials = (creds: Credentials): void => {
  fs.writeFileSync(SAVE_FILE, JSON.stringify(creds, null, 2), "utf-8");
}

const notifyLevelUp = (dinozId: number, money: number, dinozHp: number): void => {
  console.log("");
  console.log(`${C.bold}${C.green}╔══════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.green}║  🎉  LEVEL UP!  Dinoz #${dinozId}  🎉    ║${C.reset}`);
  console.log(`${C.bold}${C.green}╚══════════════════════════════════════╝${C.reset}`);
  console.log("");
  console.log(`${C.bold}Final stats:${C.reset} Gold: ${money} | Dinoz HP: ${dinozHp}`);
  process.stdout.write("\x07\x07");
}

// ── Auth / API ───────────────────────────────────────────────
const makeAuth = (user: string, token: string): string => {
  return Buffer.from(`${user}:${token}`).toString("base64");
}

const api = async <T>(
  method: "GET" | "POST" | "PUT",
  path: string,
  auth: string,
  body?: unknown,
): Promise<T> => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────
type InventoryItem = { id: number; quantity: number; };
type MoneyResponse = string;
type FicheResponse  = { life: number; };
type HealResponse   = { category: string; value: number; };
type FightResponse  = {
  goldEarned: number;
  levelUp:    boolean;
  hpLost:     { id: number; hpLost: number }[];
}

// ── Prompt helper: show saved value, keep it if user hits Enter
const ask = async (rl: readline.Interface, question: string, saved?: string): Promise<string> => {
  const hint = saved ? ` ${C.dim}[${saved}]${C.reset}` : "";
  const answer = await rl.question(`${question}${hint}: `);
  return answer.trim() || saved || "";
}

// ── Entry point ──────────────────────────────────────────────
const main = async (): Promise<void> => {
  const rl    = readline.createInterface({ input, output });
  const saved = loadCredentials();

  console.log(`\n${C.bold}DinoRPG Auto-Leveler${C.reset}\n`);
  if (saved) log(`Saved credentials found — press Enter to reuse them.\n`);

  const userCookie  = await ask(rl, "User cookie ", saved?.user);
  const tokenCookie = await ask(rl, "Token cookie", saved?.token);
  const dinozIdStr  = await ask(rl, "Dinoz ID   ", saved?.dinozId?.toString());
  rl.close();

  if (!userCookie || !tokenCookie) {
    console.error("Credentials are required."); process.exit(1);
  }

  const dinozId = parseInt(dinozIdStr, 10);
  if (isNaN(dinozId)) { console.error("Invalid Dinoz ID."); process.exit(1); }

  saveCredentials({ user: userCookie, token: tokenCookie, dinozId });

  const auth = makeAuth(userCookie, tokenCookie);

  // ── Initial fetch ────────────────────────────────────────
  log("Fetching inventory…");
  const inventory = await api<InventoryItem[]>("GET", "/inventory/all", auth);
  let potions = inventory.find(i => i.id === 1)?.quantity ?? 0;
  let heals   = inventory.find(i => i.id === 5)?.quantity ?? 0;
  ok(`Potions: ${potions}  |  Healing items: ${heals}`);

  log("Fetching wallet…");
  let money = +(await api<MoneyResponse>("GET", "/player/getmoney", auth));
  ok(`Gold: ${money}`);

  log("Fetching dinoz fiche…");
  let dinozHp = (await api<FicheResponse>("GET", `/dinoz/fiche/${dinozId}`, auth)).life;
  ok(`Dinoz #${dinozId} — HP: ${dinozHp}`);

  // ── Main loop ────────────────────────────────────────────
  let loop = 0;

  while (true) {
    loop++;
    console.log("");
    log(`--- Loop #${loop} | Gold: ${money} | HP: ${dinozHp} | Potions: ${potions} | Heals: ${heals} ---`);

    if (money < 100_000) { warn(`Gold below 100 000 (${money}). Stopping.`); break; }

    if (potions < 100) {
      warn(`Only ${potions} potions — buying 100…`);
      await api("PUT", "/shop/buyItem/1", auth, { itemId: 1, quantity: 100 });
      potions += 100;
      ok(`Bought 100 potions. Stock: ${potions}`);
      money = +(await api<MoneyResponse>("GET", "/player/getmoney", auth));
      ok(`Updated gold: ${money}`);
    }

    if (heals <= 0) {
      warn("No healing items — buying 30…");
      await api("PUT", "/shop/buyItem/5", auth, { itemId: 5, quantity: 30 });
      heals += 30;
      ok(`Bought 30 healing items. Stock: ${heals}`);
      money = +(await api<MoneyResponse>("GET", "/player/getmoney", auth));
      ok(`Updated gold: ${money}`);
    }

    if (dinozHp < 50) {
      warn(`HP low (${dinozHp}) — using a healing item…`);
      const healResult = await api<HealResponse[]>("GET", `/inventory/${dinozId}/5`, auth);
      const healValue  = healResult[0]?.value ?? 0;
      dinozHp += healValue;
      heals   -= 1;
      ok(`Healed +${healValue} HP → ${dinozHp}  | Heals left: ${heals}`);
    }

    log("Using potion (IRMA)…");
    await api("POST", `/dinoz/${dinozId}/irma`, auth);
    potions--;
    ok(`Potion used. Stock: ${potions}`);

    log("Fighting…");
    const fight  = await api<FightResponse>("PUT", "/fight", auth, { dinozId });
    const hpLost = fight.hpLost.find(e => e.id === dinozId)?.hpLost ?? 0;
    money   += fight.goldEarned;
    dinozHp -= hpLost;
    ok(`Fight done — +${fight.goldEarned}g | −${hpLost}HP | Gold: ${money} | HP: ${dinozHp}`);

    if (fight.levelUp) {
      notifyLevelUp(dinozId, money, dinozHp);
      process.exit(0);
    }
  }

  console.log("");
  log(`Session ended. Final gold: ${money} | Dinoz HP: ${dinozHp}`);
}

main().catch(e => { console.error(e); process.exit(1); });