/**
 * Deterministic, fully offline sample dataset.
 *
 * Everything here is fictional. No network, no API keys, no clock: the data is anchored to
 * SAMPLE_AS_OF_DATE and random-looking variation comes from a seeded PRNG, so every run
 * (and every test) produces byte-identical output.
 *
 * The generator emits provider-shaped records that are already in our normalized form
 * (see ../provider.ts), so they flow through the same ingestion path a real provider would.
 */
import type { AccountType, IsoDate } from "@/domain/models";
import { type Money, abs, add, money, multiplyByFraction, negate } from "@/modules/finance/money";
import { type MonthKey, monthPeriod, monthRange } from "@/modules/finance/period";
import type { NormalizedAccount, NormalizedBalance, NormalizedTransaction } from "../provider";

export const SAMPLE_AS_OF_DATE: IsoDate = "2026-09-28";
export const SAMPLE_AS_OF_TIMESTAMP = `${SAMPLE_AS_OF_DATE}T12:00:00.000Z`;
export const SAMPLE_FIRST_MONTH: MonthKey = "2026-04";
export const SAMPLE_LAST_MONTH: MonthKey = "2026-09";
/** Opening balances are as of the day before the first sample month. */
const OPENING_DATE: IsoDate = "2026-03-31";
const SEED = 20260928;

export interface SampleInstitution {
  /** Used as the provider connection id. */
  id: string;
  name: string;
}

export const SAMPLE_INSTITUTIONS = {
  evergreen: { id: "sample-inst-evergreen", name: "Evergreen Bank" },
  summit: { id: "sample-inst-summit", name: "Summit Card Services" },
  northwind: { id: "sample-inst-northwind", name: "Northwind Auto Finance" },
  harbor: { id: "sample-inst-harbor", name: "Harbor Brokerage" },
} as const satisfies Record<string, SampleInstitution>;

type InstitutionKey = keyof typeof SAMPLE_INSTITUTIONS;

interface SampleAccountDef {
  key: "checking" | "savings" | "visa" | "auto_loan" | "brokerage";
  externalAccountId: string;
  institution: InstitutionKey;
  name: string;
  type: AccountType;
  mask: string;
  openingBalance: Money;
}

const ACCOUNT_DEFS: readonly SampleAccountDef[] = [
  { key: "checking", externalAccountId: "smp-acct-chk-1934", institution: "evergreen", name: "Everyday Checking", type: "checking", mask: "1934", openingBalance: money(425_000) },
  { key: "savings", externalAccountId: "smp-acct-sav-4821", institution: "evergreen", name: "High-Yield Savings", type: "savings", mask: "4821", openingBalance: money(1_840_000) },
  { key: "visa", externalAccountId: "smp-acct-visa-7702", institution: "summit", name: "Summit Rewards Visa", type: "credit", mask: "7702", openingBalance: money(-128_643) },
  { key: "auto_loan", externalAccountId: "smp-acct-loan-3310", institution: "northwind", name: "Auto Loan", type: "loan", mask: "3310", openingBalance: money(-1_680_000) },
  { key: "brokerage", externalAccountId: "smp-acct-brk-5566", institution: "harbor", name: "Individual Brokerage", type: "investment", mask: "5566", openingBalance: money(4_215_000) },
];

type AccountKey = SampleAccountDef["key"];

/** mulberry32: tiny, fast, seedable PRNG. Deterministic across platforms. */
function createRng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** Integer in [min, max]. */
    int(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** Money in [min, max] cents. */
    cents(min: number, max: number): Money {
      return money(min + Math.floor(next() * (max - min + 1)));
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)]!;
    },
    chance(p: number): boolean {
      return next() < p;
    },
  };
}

interface Merchant {
  merchant: string;
  description: string;
}

const GROCERS: Merchant[] = [
  { merchant: "Trader Joe's", description: "TRADER JOE'S #552 SAN FRANCISCO CA" },
  { merchant: "Whole Foods Market", description: "WHOLEFDS MKT #10234 SAN FRANCISCO" },
  { merchant: "Safeway", description: "SAFEWAY #1789 SAN FRANCISCO CA" },
];
const RESTAURANTS: Merchant[] = [
  { merchant: "Chipotle", description: "CHIPOTLE 2291 SAN FRANCISCO CA" },
  { merchant: "Nopa", description: "SQ *NOPA RESTAURANT SAN FRANCISCO" },
  { merchant: "Hops & Hominy", description: "TST* HOPS & HOMINY SAN FRANCISCO" },
  { merchant: "Thai House", description: "DOORDASH*THAI HOUSE 855-973-1040" },
  { merchant: "Sweetgreen", description: "SWEETGREEN SOMA SAN FRANCISCO" },
];
const COFFEE: Merchant[] = [
  { merchant: "Blue Bottle Coffee", description: "BLUE BOTTLE COFFEE OAKLAND CA" },
  { merchant: "Starbucks", description: "STARBUCKS STORE 05871 SAN FRANCISCO" },
];
const SHOPS: Merchant[] = [
  { merchant: "Amazon", description: "AMAZON MKTPL*2K4RT1Q30 AMZN.COM/BILL WA" },
  { merchant: "Target", description: "TARGET 00012345 SAN FRANCISCO CA" },
  { merchant: "Uniqlo", description: "UNIQLO USA LLC SAN FRANCISCO CA" },
];
const GAS: Merchant[] = [
  { merchant: "Shell", description: "SHELL OIL 57442 SAN FRANCISCO CA" },
  { merchant: "Chevron", description: "CHEVRON 0098765 DALY CITY CA" },
];

interface Draft {
  account: AccountKey;
  date: IsoDate;
  merchant: string;
  description: string;
  amount: Money;
  pending?: boolean;
  /** Provider-neutral category hint (slug in our taxonomy), as a real adapter would map it. */
  hint?: string;
}

export interface SampleDataset {
  institutions: SampleInstitution[];
  accounts: (NormalizedAccount & { institutionId: string })[];
  transactions: (NormalizedTransaction & { institutionId: string })[];
  balances: (NormalizedBalance & { institutionId: string })[];
  /** Suggested user annotations applied after import to demonstrate exclusions/notes. */
  annotations: { externalTransactionId: string; notes: string; excludedFromReports: boolean }[];
}

const day = (month: MonthKey, d: number): IsoDate => `${month}-${String(d).padStart(2, "0")}`;

function lastDay(month: MonthKey): number {
  return Number(monthPeriod(month).end.slice(8));
}

/** One month of interest at an annual rate in basis points, computed exactly (BigInt) and rounded once. */
function monthlyInterest(balance: Money, annualRateBps: number): Money {
  return multiplyByFraction(abs(balance), annualRateBps, 10_000 * 12);
}

export function generateSampleDataset(): SampleDataset {
  const rng = createRng(SEED);
  const drafts: Draft[] = [];
  const running = new Map<AccountKey, Money>(ACCOUNT_DEFS.map((a) => [a.key, a.openingBalance]));
  const post = (d: Draft) => drafts.push(d);

  let previousMonthCardCharges = negate(ACCOUNT_DEFS.find((a) => a.key === "visa")!.openingBalance);
  const months = monthRange(SAMPLE_FIRST_MONTH, SAMPLE_LAST_MONTH);

  for (const month of months) {
    const monthStartIndex = drafts.length;
    const dim = lastDay(month);

    // ---- Income -------------------------------------------------------------------------
    for (const d of [1, 15]) {
      post({ account: "checking", date: day(month, d), merchant: "Acme Corp", description: "ACME CORP PAYROLL PPD ID: 9912345", amount: money(315_000), hint: "paycheck" });
    }

    // ---- Housing & bills from checking --------------------------------------------------
    post({ account: "checking", date: day(month, 1), merchant: "Oakwood Properties", description: "ZELLE PAYMENT TO OAKWOOD PROPERTIES", amount: money(-215_000) });
    post({ account: "checking", date: day(month, 8), merchant: "GEICO", description: "GEICO *AUTO PREMIUM 800-841-3000", amount: money(-12_840) });
    post({ account: "checking", date: day(month, 12), merchant: "PG&E", description: "PGANDE WEB ONLINE PAYMENT", amount: negate(rng.cents(7_800, 14_500)) });

    // ---- Transfers between own accounts (both legs) -------------------------------------
    post({ account: "checking", date: day(month, 3), merchant: "Transfer to Savings", description: "ONLINE TRANSFER TO SAVINGS XXXX4821", amount: money(-50_000), hint: "transfer" });
    post({ account: "savings", date: day(month, 3), merchant: "Transfer from Checking", description: "ONLINE TRANSFER FROM CHECKING XXXX1934", amount: money(50_000), hint: "transfer" });

    post({ account: "checking", date: day(month, 5), merchant: "Harbor Brokerage", description: "HARBOR BROKERAGE ACH CONTRIB", amount: money(-40_000), hint: "investment_contribution" });
    post({ account: "brokerage", date: day(month, 5), merchant: "Contribution", description: "ACH CONTRIBUTION RECEIVED", amount: money(40_000), hint: "investment_contribution" });

    // ---- Auto loan: interest accrues on the 1st, payment on the 10th ---------------------
    const loanInterest = monthlyInterest(running.get("auto_loan")!, 590);
    post({ account: "auto_loan", date: day(month, 1), merchant: "Northwind Auto Finance", description: "INTEREST CHARGE", amount: negate(loanInterest), hint: "interest_fees" });
    post({ account: "checking", date: day(month, 10), merchant: "Northwind Auto Finance", description: "NORTHWIND AUTO FIN PMT", amount: money(-38_900), hint: "loan_payment" });
    post({ account: "auto_loan", date: day(month, 10), merchant: "Payment Received", description: "AUTO LOAN PAYMENT RECEIVED", amount: money(38_900), hint: "loan_payment" });

    // ---- Credit card: pay last month's charges in full on the 22nd -----------------------
    post({ account: "checking", date: day(month, 22), merchant: "Summit Card Services", description: "SUMMIT CARD ONLINE PMT", amount: negate(previousMonthCardCharges), hint: "credit_card_payment" });
    post({ account: "visa", date: day(month, 22), merchant: "Payment Received", description: "ONLINE PAYMENT - THANK YOU", amount: previousMonthCardCharges, hint: "credit_card_payment" });

    // ---- Card spending -----------------------------------------------------------------
    const card = (d: number, m: Merchant, amount: Money) =>
      post({ account: "visa", date: day(month, Math.min(d, dim)), merchant: m.merchant, description: m.description, amount: negate(amount) });

    for (const d of [2, 9, 16, 23, 30]) card(d, rng.pick(GROCERS), rng.cents(6_500, 17_500));
    for (let i = 0; i < 5; i++) card(rng.int(1, dim), rng.pick(RESTAURANTS), rng.cents(1_400, 9_500));
    for (let i = 0; i < 6; i++) card(rng.int(1, dim), rng.pick(COFFEE), rng.cents(450, 875));
    for (let i = 0; i < rng.int(1, 3); i++) card(rng.int(1, dim), rng.pick(SHOPS), rng.cents(1_800, 12_000));
    for (const d of [7, 21]) card(d, rng.pick(GAS), rng.cents(3_800, 6_200));
    if (rng.chance(0.7)) card(rng.int(1, dim), { merchant: "Uber", description: "UBER *TRIP HELP.UBER.COM" }, rng.cents(1_200, 3_800));
    card(2, { merchant: "City Fitness Club", description: "CITY FITNESS CLUB MONTHLY" }, money(4_900));
    card(6, { merchant: "Netflix", description: "NETFLIX.COM LOS GATOS CA" }, money(1_549));
    card(14, { merchant: "Spotify", description: "SPOTIFY USA 877-778-1161" }, money(1_199));
    card(20, { merchant: "Apple iCloud", description: "APPLE.COM/BILL 866-712-7753" }, money(299));
    card(18, { merchant: "Xfinity", description: "COMCAST XFINITY 800-266-2278" }, money(7_999));
    card(25, { merchant: "Verizon", description: "VERIZON WIRELESS PAYMENTS" }, money(6_500));
    if (rng.chance(0.5)) card(rng.int(1, dim), { merchant: "CVS Pharmacy", description: "CVS/PHARMACY #09821" }, rng.cents(900, 4_200));
    if (rng.chance(0.4)) card(rng.int(1, dim), { merchant: "AMC Theatres", description: "AMC 9640 ONLINE" }, rng.cents(2_400, 4_800));

    // ---- One-off events ------------------------------------------------------------------
    if (month === "2026-05") {
      post({ account: "visa", date: day(month, 19), merchant: "Amazon", description: "AMAZON MKTPL REFUND*RT88K2", amount: money(3_499) });
    }
    if (month === "2026-06") {
      post({ account: "checking", date: day(month, 14), merchant: "ATM Withdrawal", description: "ATM WITHDRAWAL 0442 MARKET ST", amount: money(-6_000) });
      card(11, { merchant: "Best Buy", description: "BEST BUY 00011 SAN FRANCISCO" }, money(24_999));
    }
    if (month === "2026-07") {
      card(8, { merchant: "United Airlines", description: "UNITED 0162345678901 HOUSTON TX" }, money(41_260));
      card(20, { merchant: "Marriott", description: "MARRIOTT SEATTLE WATERFRONT" }, money(68_925));
    }
    if (month === "2026-08") {
      // Work trip paid personally and reimbursed later: excluded from reports (see annotations).
      card(12, { merchant: "Delta Air Lines", description: "DELTA AIR LINES 0062378812" }, money(31_840));
    }
    if (month === "2026-09") {
      post({ account: "checking", date: day(month, 16), merchant: "Acme Corp", description: "ACME CORP EXPENSE REIMB", amount: money(31_840) });
    }

    // ---- Savings interest on the last day of the month -----------------------------------
    if (day(month, dim) <= SAMPLE_AS_OF_DATE) {
      const savingsSoFar = drafts
        .slice(monthStartIndex)
        .filter((d) => d.account === "savings")
        .reduce((t, d) => add(t, d.amount), running.get("savings")!);
      post({ account: "savings", date: day(month, dim), merchant: "Evergreen Bank", description: "INTEREST PAID", amount: monthlyInterest(savingsSoFar, 400), hint: "interest_income" });
    }

    // Drop anything dated after the as-of date (the current month is partial).
    for (let i = drafts.length - 1; i >= monthStartIndex; i--) {
      if (drafts[i]!.date > SAMPLE_AS_OF_DATE) drafts.splice(i, 1);
    }

    // Close the month: update running balances and next month's card payment.
    let cardCharges = money(0);
    for (const d of drafts.slice(monthStartIndex)) {
      running.set(d.account, add(running.get(d.account)!, d.amount));
      if (d.account === "visa" && d.description !== "ONLINE PAYMENT - THANK YOU") cardCharges = add(cardCharges, negate(d.amount));
    }
    previousMonthCardCharges = cardCharges;
  }

  // ---- Pending transactions: recent card activity that hasn't posted yet -----------------
  drafts.push(
    { account: "visa", date: "2026-09-27", merchant: "Whole Foods Market", description: "WHOLEFDS MKT #10234 SAN FRANCISCO", amount: money(-8_712), pending: true },
    { account: "visa", date: "2026-09-28", merchant: "Sweetgreen", description: "SWEETGREEN SOMA SAN FRANCISCO", amount: money(-1_895), pending: true },
  );

  return assemble(drafts);
}

function assemble(drafts: Draft[]): SampleDataset {
  const defsByKey = new Map(ACCOUNT_DEFS.map((a) => [a.key, a]));

  // Stable order: by date, then account, then insertion order.
  const ordered = drafts
    .map((d, index) => ({ d, index }))
    .sort((a, b) => a.d.date.localeCompare(b.d.date) || a.d.account.localeCompare(b.d.account) || a.index - b.index);

  const perDayCounter = new Map<string, number>();
  const transactions = ordered.map(({ d }) => {
    const def = defsByKey.get(d.account)!;
    const counterKey = `${d.account}|${d.date}`;
    const seq = (perDayCounter.get(counterKey) ?? 0) + 1;
    perDayCounter.set(counterKey, seq);
    return {
      institutionId: SAMPLE_INSTITUTIONS[def.institution].id,
      externalTransactionId: `smp-txn-${def.mask}-${d.date.replaceAll("-", "")}-${String(seq).padStart(3, "0")}`,
      externalAccountId: def.externalAccountId,
      date: d.date,
      merchantName: d.merchant,
      originalDescription: d.description,
      amount: d.amount,
      currency: "USD",
      pending: d.pending ?? false,
      categoryHint: d.hint ?? null,
    };
  });

  // ---- Balances --------------------------------------------------------------------------
  // Month-end snapshots (plus the as-of date). Ledger accounts: opening + posted transactions.
  // The brokerage is marked to market, so its value comes from a separate deterministic
  // series (contributions + market movement) rather than from transactions.
  const snapshotDates = [OPENING_DATE, ...monthRange(SAMPLE_FIRST_MONTH, SAMPLE_LAST_MONTH).map((m) => monthPeriod(m).end)]
    .filter((d) => d < SAMPLE_AS_OF_DATE)
    .concat(SAMPLE_AS_OF_DATE);

  const marketRng = createRng(SEED + 1);
  const brokerageSeries = new Map<IsoDate, Money>();
  let brokerageValue = defsByKey.get("brokerage")!.openingBalance;
  let previous = OPENING_DATE;
  for (const date of snapshotDates) {
    if (date !== OPENING_DATE) {
      const contributions = transactions
        .filter((t) => t.externalAccountId === defsByKey.get("brokerage")!.externalAccountId && t.date > previous && t.date <= date && !t.pending)
        .reduce((s, t) => add(s, t.amount), money(0));
      // Market move between -1.5% and +2.5%, in basis points, applied with integer rounding.
      const moveBps = marketRng.int(-150, 250);
      const move = multiplyByFraction(brokerageValue, moveBps, 10_000);
      brokerageValue = add(add(brokerageValue, contributions), move);
    }
    brokerageSeries.set(date, brokerageValue);
    previous = date;
  }

  const balances: SampleDataset["balances"] = [];
  const accounts: SampleDataset["accounts"] = [];
  for (const def of ACCOUNT_DEFS) {
    const institutionId = SAMPLE_INSTITUTIONS[def.institution].id;
    let latest = def.openingBalance;
    for (const date of snapshotDates) {
      const balance =
        def.key === "brokerage"
          ? brokerageSeries.get(date)!
          : transactions
              .filter((t) => t.externalAccountId === def.externalAccountId && !t.pending && t.date <= date)
              .reduce((s, t) => add(s, t.amount), def.openingBalance);
      balances.push({ institutionId, externalAccountId: def.externalAccountId, date, balance });
      latest = balance;
    }
    accounts.push({
      institutionId,
      externalAccountId: def.externalAccountId,
      name: def.name,
      institutionName: SAMPLE_INSTITUTIONS[def.institution].name,
      type: def.type,
      mask: def.mask,
      currency: "USD",
      currentBalance: latest,
      balanceAsOf: SAMPLE_AS_OF_TIMESTAMP,
    });
  }

  const delta = transactions.find((t) => t.originalDescription.startsWith("DELTA AIR LINES"))!;
  const reimbursement = transactions.find((t) => t.originalDescription === "ACME CORP EXPENSE REIMB")!;

  return {
    institutions: Object.values(SAMPLE_INSTITUTIONS),
    accounts,
    transactions,
    balances,
    annotations: [
      { externalTransactionId: delta.externalTransactionId, notes: "Work trip — reimbursed by Acme in September.", excludedFromReports: true },
      { externalTransactionId: reimbursement.externalTransactionId, notes: "Reimbursement for August work flight.", excludedFromReports: true },
    ],
  };
}
