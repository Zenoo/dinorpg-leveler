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

const notifyLevelUp = (state: State, average: Average): void => {
  console.log("");
  console.log(`${C.bold}${C.green}╔══════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.green}║  🎉  LEVEL UP!  Dinoz #${state.dinoz.id}  🎉    ║${C.reset}`);
  console.log(`${C.bold}${C.green}╚══════════════════════════════════════╝${C.reset}`);
  console.log("");
  console.log(`${C.bold}Final stats:${C.reset} Gold: ${state.money} | Dinoz HP: ${state.dinoz.hp}/${state.dinoz.maxHp}`);
  console.log(`${C.bold}Average per fight:${C.reset} +${average.goldEarned.toFixed(2)}g | +${average.xpEarned.toFixed(2)}XP | −${average.hpLost.toFixed(2)}HP`);
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
type FicheResponse  = { life: number; maxLife: number; };
type HealResponse   = { category: string; value: number; };
type FightResponse  = {
  goldEarned: number;
  xpEarned: number;
  levelUp:    boolean;
  hpLost:     { id: number; hpLost: number }[];
}
type State = {
  money: number;
  dinoz: { id: number; hp: number; maxHp: number; };
  potions: number;
  heals: { small: number; big: number; };
}
type Average = {
  hpLost: number;
  xpEarned: number;
  goldEarned: number;
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

  const state: State = {
    money: 0,
    dinoz: {
      id: dinozId,
      hp: 0,
      maxHp: 0,
    },
    potions: 0,
    heals: {
      small: 0,
      big: 0,
    }
  };
  const average = {
    hpLost: 0,
    xpEarned: 0,
    goldEarned: 0,
  };
  let fightsCount = 0;

  // ── Initial fetch ────────────────────────────────────────
  log("Fetching inventory…");
  const inventory = await api<InventoryItem[]>("GET", "/inventory/all", auth);
  state.potions = inventory.find(i => i.id === 1)?.quantity ?? 0;
  state.heals.small = inventory.find(i => i.id === 5)?.quantity ?? 0;
  state.heals.big = inventory.find(i => i.id === 4)?.quantity ?? 0;
  ok(`Potions: ${state.potions}  |  Small Heals: ${state.heals.small}  |  Big Heals: ${state.heals.big}`);

  log("Fetching wallet…");
  state.money = +(await api<MoneyResponse>("GET", "/player/getmoney", auth));
  ok(`Gold: ${state.money}`);

  log("Fetching dinoz fiche…");
  const dinozData = await api<FicheResponse>("GET", `/dinoz/fiche/${state.dinoz.id}`, auth);
  state.dinoz.hp = dinozData.life;
  state.dinoz.maxHp = dinozData.maxLife;
  ok(`Dinoz #${state.dinoz.id} — HP: ${state.dinoz.hp}/${state.dinoz.maxHp}`);

  // ── Main loop ────────────────────────────────────────────
  let loop = 0;

  while (true) {
    loop++;
    console.log("");
    log(`--- Loop #${loop} | Gold: ${state.money} | HP: ${state.dinoz.hp}/${state.dinoz.maxHp} | Potions: ${state.potions} | Small Heals: ${state.heals.small} | Big Heals: ${state.heals.big} ---`);

    if (state.money < 100_000) { warn(`Gold below 100 000 (${state.money}). Stopping.`); break; }

    if (state.potions < 100) {
      warn(`Only ${state.potions} potions — buying 100…`);
      await api("PUT", "/shop/buyItem/1", auth, { itemId: 1, quantity: 100 });
      state.potions += 100;
      ok(`Bought 100 potions. Stock: ${state.potions}`);
      state.money = +(await api<MoneyResponse>("GET", "/player/getmoney", auth));
      ok(`Updated gold: ${state.money}`);
    }

    if (state.heals.small <= 0) {
      warn("No small healing items — buying 30…");
      await api("PUT", "/shop/buyItem/1", auth, { itemId: 5, quantity: 30 });
      state.heals.small += 30;
      ok(`Bought 30 small healing items. Stock: ${state.heals.small}`);
      state.money = +(await api<MoneyResponse>("GET", "/player/getmoney", auth));
      ok(`Updated gold: ${state.money}`);
    }

    if (state.heals.big <= 0) {
      warn("No big healing items — buying 10…");
      await api("PUT", "/shop/buyItem/1", auth, { itemId: 4, quantity: 10 });
      state.heals.big += 10;
      ok(`Bought 10 big healing items. Stock: ${state.heals.big}`);
      state.money = +(await api<MoneyResponse>("GET", "/player/getmoney", auth));
      ok(`Updated gold: ${state.money}`);
    }

    // Use big heals for 150HP+ Dinoz, small heals for lower HP thresholds
    let healSize: "small" | "big" = "small";
    if (state.dinoz.maxHp > 150) {
      healSize = "big";
    }

    if ((healSize === "big" && state.dinoz.maxHp - state.dinoz.hp >= 110) || (healSize === "small" && state.dinoz.maxHp - state.dinoz.hp >= 33)) {
      warn(`HP low (${state.dinoz.hp}) — using a healing item…`);
      const healResult = await api<HealResponse[]>("GET", `/inventory/${state.dinoz.id}/${healSize === "big" ? 4 : 5}`, auth);
      const healValue  = healResult[0]?.value ?? 0;
      state.dinoz.hp += healValue;
      state.heals[healSize] -= 1;
      ok(`Healed +${healValue} HP → ${state.dinoz.hp}  | Heals left: ${state.heals[healSize]}`);
    }

    log("Using potion (IRMA)…");
    await api("POST", `/dinoz/${state.dinoz.id}/irma`, auth);
    state.potions--;
    ok(`Potion used. Stock: ${state.potions}`);

    log("Fighting…");
    const fight  = await api<FightResponse>("PUT", "/fight", auth, { dinozId: state.dinoz.id });
    const hpLost = fight.hpLost.find(e => e.id === state.dinoz.id)?.hpLost ?? 0;
    state.money   += fight.goldEarned;
    state.dinoz.hp -= hpLost;
    ok(`Fight done — +${fight.goldEarned}g | −${hpLost}HP | Gold: ${state.money} | HP: ${state.dinoz.hp}`);

    // Stats
    fightsCount++;
    average.hpLost = ((average.hpLost * (fightsCount - 1)) + hpLost) / fightsCount;
    average.goldEarned = ((average.goldEarned * (fightsCount - 1)) + fight.goldEarned) / fightsCount;
    average.xpEarned = ((average.xpEarned * (fightsCount - 1)) + fight.xpEarned) / fightsCount;

    if (fight.levelUp) {
      notifyLevelUp(state, average);
      process.exit(0);
    }
  }

  console.log("");
  log(`Session ended. Final gold: ${state.money} | Dinoz HP: ${state.dinoz.hp}`);
}

main().catch(e => { console.error(e); process.exit(1); });