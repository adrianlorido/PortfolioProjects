/**
 * Sample-mode isolation (review area L): no network, no credentials, deterministic output.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_USER, createSampleRepository } from "@/db/sample-bootstrap";
import { generateSampleDataset } from "./dataset";

describe("sample mode performs no network access", () => {
  const attempts: string[] = [];
  const block = (name: string) => () => {
    attempts.push(name);
    throw new Error(`Network access attempted in sample mode: ${name}`);
  };

  beforeEach(() => {
    attempts.length = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(block("fetch"));
    vi.spyOn(http, "request").mockImplementation(block("http.request"));
    vi.spyOn(http, "get").mockImplementation(block("http.get"));
    vi.spyOn(https, "request").mockImplementation(block("https.request"));
    vi.spyOn(https, "get").mockImplementation(block("https.get"));
    vi.spyOn(net, "connect").mockImplementation(block("net.connect"));
    vi.spyOn(net, "createConnection").mockImplementation(block("net.createConnection"));
    vi.spyOn(net.Socket.prototype, "connect").mockImplementation(block("net.Socket.connect"));
    vi.spyOn(tls, "connect").mockImplementation(block("tls.connect"));
    vi.spyOn(dns, "lookup").mockImplementation(block("dns.lookup"));
  });
  afterEach(() => vi.restoreAllMocks());

  it("generating the dataset and running the full connect + sync pipeline makes zero network calls", async () => {
    generateSampleDataset();
    const repo = await createSampleRepository();
    expect((await repo.listTransactions(SAMPLE_USER.id)).length).toBeGreaterThan(200);
    expect(attempts).toEqual([]);
  });

  it("the guard itself works (sanity check that a network call would be caught)", () => {
    expect(() => fetch("https://example.com")).toThrow(/Network access attempted/);
    expect(attempts).toEqual(["fetch"]);
  });
});

describe("sample mode needs no credentials", () => {
  it("builds the full dataset with an empty environment", async () => {
    const saved = { ...process.env };
    try {
      for (const key of Object.keys(process.env)) {
        if (/PLAID|SUPABASE|SECRET|TOKEN|KEY/i.test(key)) delete process.env[key];
      }
      const repo = await createSampleRepository();
      expect(await repo.listAccounts(SAMPLE_USER.id)).toHaveLength(5);
    } finally {
      process.env = saved;
    }
  });
});

describe("sample output is deterministic end to end", () => {
  it("two independent builds produce identical internal ids, amounts, categories and snapshots", async () => {
    const [a, b] = await Promise.all([createSampleRepository(), createSampleRepository()]);
    const dump = async (repo: Awaited<ReturnType<typeof createSampleRepository>>) => ({
      connections: await repo.listConnections(SAMPLE_USER.id),
      accounts: await repo.listAccounts(SAMPLE_USER.id),
      transactions: await repo.listTransactions(SAMPLE_USER.id),
      snapshots: await repo.listBalanceSnapshots(SAMPLE_USER.id),
    });
    const [da, db] = await Promise.all([dump(a), dump(b)]);
    expect(JSON.stringify(da)).toBe(JSON.stringify(db));
    expect(da.transactions.every((t) => /^txn_\d{6}$/.test(t.id))).toBe(true);
  });
});

describe("non-sample data modes fail closed in Phase 1", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("DATA_MODE=supabase refuses to serve data instead of falling back", async () => {
    vi.stubEnv("DATA_MODE", "supabase");
    vi.resetModules();
    const { getRepository } = await import("@/db");
    expect(() => getRepository()).toThrow(/not implemented in Phase 1/);
  });

  it("an unknown DATA_MODE is a configuration error", async () => {
    vi.stubEnv("DATA_MODE", "production");
    vi.resetModules();
    const { getServerEnv } = await import("@/lib/env");
    expect(() => getServerEnv()).toThrow(/Invalid environment/);
  });
});
