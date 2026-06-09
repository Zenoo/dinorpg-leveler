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
const error = (msg: string) => console.log(`${C.yellow}[${ts()}] ✗${C.reset} ${msg}`);

// ── Saved credentials ────────────────────────────────────────
type Credentials = { user?: string; token?: string; dinozId?: number; useMerguez?: boolean; };

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
  console.log(`${C.bold}Final stats:${C.reset} Gold: ${state.money} | Dinoz HP: ${state.dinoz.hp}/${state.dinoz.maxHp} | Small heals used: ${state.heals.used.small} | Big heals used: ${state.heals.used.big} | Merguez used: ${state.merguez.used}`);
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
type FicheResponse  = { life: number; maxLife: number; items: number[]; maxItems: number; };
type HealResponse   = { category: string; value: number; };
type FightResponse  = {
  goldEarned: number;
  xpEarned: number;
  levelUp:    boolean;
  hpLost:     { id: number; hpLost: number }[];
  itemsUsed: { id: number; itemsUsed: number[]; }[];
}
type State = {
  money: number;
  dinoz: { id: number; hp: number; maxHp: number; items: number[]; maxItems: number; };
  potions: number;
  merguez: {
    use: boolean;
    count: number;
    used: number;
  };
  heals: {
    small: number;
    big: number;
    used: { small: number; big: number; };
  };
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
  const useMerguez = await ask(rl, "Use merguez? (yes/no)", saved?.useMerguez ? "yes" : "no");
  const dinozIdStr  = await ask(rl, "Dinoz ID   ", saved?.dinozId?.toString());
  rl.close();

  if (!userCookie || !tokenCookie) {
    console.error("Credentials are required."); process.exit(1);
  }

  const dinozId = parseInt(dinozIdStr, 10);
  if (isNaN(dinozId)) { console.error("Invalid Dinoz ID."); process.exit(1); }

  const shouldUseMerguez = useMerguez ? useMerguez.toLowerCase() !== "no" : (saved?.useMerguez ?? false);
  saveCredentials({ user: userCookie, token: tokenCookie, dinozId, useMerguez: shouldUseMerguez });

  const auth = makeAuth(userCookie, tokenCookie);

  const state: State = {
    money: 0,
    dinoz: {
      id: dinozId,
      hp: 0,
      maxHp: 0,
      items: [],
      maxItems: 0,
    },
    potions: 0,
    merguez: {
      use: shouldUseMerguez,
      count: 0,
      used: 0,
    },
    heals: {
      small: 0,
      big: 0,
      used: { small: 0, big: 0 },
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
  state.merguez.count = inventory.find(i => i.id === 8)?.quantity ?? 0;
  state.heals.small = inventory.find(i => i.id === 5)?.quantity ?? 0;
  state.heals.big = inventory.find(i => i.id === 4)?.quantity ?? 0;
  ok(`Potions: ${state.potions}  |  Small Heals: ${state.heals.small}  |  Big Heals: ${state.heals.big}  |  Merguez: ${state.merguez.count}`);

  log("Fetching wallet…");
  state.money = +(await api<MoneyResponse>("GET", "/player/getmoney", auth));
  ok(`Gold: ${state.money}`);

  log("Fetching dinoz fiche…");
  const dinozData = await api<FicheResponse>("GET", `/dinoz/fiche/${state.dinoz.id}`, auth);
  state.dinoz.hp = dinozData.life;
  state.dinoz.maxHp = dinozData.maxLife;
  state.dinoz.items = dinozData.items;
  state.dinoz.maxItems = dinozData.maxItems;
  ok(`Dinoz #${state.dinoz.id} — HP: ${state.dinoz.hp}/${state.dinoz.maxHp} | Items: ${state.dinoz.items.length}/${state.dinoz.maxItems}`);

  // ── Main loop ────────────────────────────────────────────
  let loop = 0;

  while (true) {
    loop++;
    console.log("");
    log(`--- Loop #${loop} | Gold: ${state.money} | HP: ${state.dinoz.hp}/${state.dinoz.maxHp} | Potions: ${state.potions} | Small Heals: ${state.heals.small} | Big Heals: ${state.heals.big} | Merguez: ${state.merguez.count} ---`);

    if (state.merguez.use && state.merguez.count === 0) {
      error("No merguez left — please restock and try again. Stopping.");
      break;
    }

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
      state.heals.used[healSize] += 1;
      ok(`Healed +${healValue} HP → ${state.dinoz.hp}  | Heals left: ${state.heals[healSize]}`);
    }

    // Refill merguez slots
    if (state.merguez.use && state.dinoz.items.length < state.dinoz.maxItems) {
      const slotsToFill = state.dinoz.maxItems - state.dinoz.items.length;
      const merguezToUse = Math.min(state.merguez.count, slotsToFill);

      if (merguezToUse > 0) {
        log(`Refilling inventory with ${merguezToUse} merguez…`);
        for (let i = 0; i < merguezToUse; i++) {
          await api("PUT", `/inventory/${state.dinoz.id}`, auth, { itemId: 8, equip: true });
          state.merguez.count -= 1;
          state.dinoz.items.push(8);
        }
        ok(`Inventory refilled. Merguez left: ${state.merguez.count} | Inventory: ${state.dinoz.items.length}/${state.dinoz.maxItems}`);
      }
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
    
    const merguezUsed = fight.itemsUsed.find(e => e.id === state.dinoz.id)?.itemsUsed.filter(id => id === 8).length ?? 0;
    if (merguezUsed > 0) {
      for (let i = 0; i < merguezUsed; i++) {
        const index = state.dinoz.items.indexOf(8);
        if (index !== -1) {
          state.dinoz.items.splice(index, 1);
        }
      }
    }

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
  log(`Session ended. Final stats: Gold: ${state.money} | Dinoz HP: ${state.dinoz.hp}/${state.dinoz.maxHp} | Potions: ${state.potions} | Small Heals: ${state.heals.small} | Big Heals: ${state.heals.big} | Merguez: ${state.merguez.count}`);
}

main().catch(e => { console.error(e); process.exit(1); });