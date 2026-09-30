/**
 * Architecture boundaries (review area M), enforced by reading import statements.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs = [...text.matchAll(/(?:import|export)\s[^"'`]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g)];
  return specs.map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]!).filter(Boolean);
}

const rel = (f: string) => path.relative(SRC, f);
const NETWORK = /^(node:)?(http|https|net|tls|dns|dgram|http2)$|axios|node-fetch|undici|got$|ky$|plaid|@supabase/;

describe("finance engine purity", () => {
  const files = sourceFiles(path.join(SRC, "modules/finance"));

  it("imports only its own files and domain types", () => {
    const violations = files.flatMap((f) =>
      importsOf(f)
        .filter((spec) => !spec.startsWith("./") && spec !== "@/domain/models")
        .map((spec) => `${rel(f)} -> ${spec}`),
    );
    expect(violations).toEqual([]);
  });

  it("has no clock, randomness, environment or I/O", () => {
    const violations = files.flatMap((f) => {
      const text = readFileSync(f, "utf8");
      return ["Date.now(", "new Date()", "Math.random(", "process.env", "fetch("].filter((needle) => text.includes(needle)).map((n) => `${rel(f)}: ${n}`);
    });
    expect(violations).toEqual([]);
  });
});

describe("provider isolation", () => {
  it("only the sample bootstrap (and the sample adapter itself) imports the sample integration", () => {
    const violations = sourceFiles(SRC)
      .filter((f) => !rel(f).startsWith("integrations/sample/") && rel(f) !== "db/sample-bootstrap.ts")
      .flatMap((f) => importsOf(f).filter((s) => s.startsWith("@/integrations/sample")).map((s) => `${rel(f)} -> ${s}`));
    expect(violations).toEqual([]);
  });

  it("nothing imports the (future) Plaid adapter, and core modules never import provider SDKs or network libraries", () => {
    const violations = sourceFiles(SRC).flatMap((f) =>
      importsOf(f)
        .filter((s) => s.startsWith("@/integrations/plaid") || NETWORK.test(s))
        .map((s) => `${rel(f)} -> ${s}`),
    );
    expect(violations).toEqual([]);
  });

  it("core modules depend on the provider interface only, never on an adapter", () => {
    const violations = sourceFiles(path.join(SRC, "modules")).flatMap((f) =>
      importsOf(f)
        .filter((s) => s.startsWith("@/integrations/") && s !== "@/integrations/provider")
        .map((s) => `${rel(f)} -> ${s}`),
    );
    expect(violations).toEqual([]);
  });
});

describe("layering", () => {
  it("domain and modules never import UI (app/, components/, react, next)", () => {
    const dirs = ["domain", "modules", "integrations", "db"].map((d) => path.join(SRC, d));
    const violations = dirs.flatMap(sourceFiles).flatMap((f) =>
      importsOf(f)
        .filter((s) => s.startsWith("@/app") || s.startsWith("@/components") || s === "react" || s.startsWith("next"))
        .map((s) => `${rel(f)} -> ${s}`),
    );
    expect(violations).toEqual([]);
  });

  it("only server-only entry points read the environment", () => {
    const readers = sourceFiles(SRC).filter((f) => readFileSync(f, "utf8").includes("process.env")).map(rel);
    expect(readers).toEqual(["lib/env.ts"]);
    expect(readFileSync(path.join(SRC, "lib/env.ts"), "utf8")).toMatch(/^import "server-only";/m);
  });

  it("UI code does no money arithmetic of its own (only formatting / display ratios)", () => {
    const ui = [...sourceFiles(path.join(SRC, "app")), ...sourceFiles(path.join(SRC, "components"))];
    const violations = ui.flatMap((f) => {
      const text = readFileSync(f, "utf8");
      return ["add(", "subtract(", "negate(", "sum(", "calculate"].filter((n) => new RegExp(`\\b${n.replace("(", "\\(")}`).test(text)).map((n) => `${rel(f)} uses ${n}`);
    });
    expect(violations).toEqual([]);
  });
});
