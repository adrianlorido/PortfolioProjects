import type { Domain, DomainId } from "@/lib/types";

/** SY0-701 domain structure. Weights are the published approximate exam percentages. */
export const DOMAINS: readonly Domain[] = [
  {
    id: 1,
    code: "1.0",
    name: "General Security Concepts",
    shortName: "General Concepts",
    slug: "general-security-concepts",
    weight: 12,
    description: "Security controls, the CIA triad, AAA, Zero Trust, change management and cryptographic foundations.",
  },
  {
    id: 2,
    code: "2.0",
    name: "Threats, Vulnerabilities, and Mitigations",
    shortName: "Threats & Vulnerabilities",
    slug: "threats-vulnerabilities-mitigations",
    weight: 22,
    description: "Threat actors, attack vectors, malware, application and network attacks, indicators and mitigations.",
  },
  {
    id: 3,
    code: "3.0",
    name: "Security Architecture",
    shortName: "Architecture",
    slug: "security-architecture",
    weight: 18,
    description: "Cloud, virtualization, network design, segmentation, data protection and resilience.",
  },
  {
    id: 4,
    code: "4.0",
    name: "Security Operations",
    shortName: "Operations",
    slug: "security-operations",
    weight: 28,
    description: "IAM, monitoring, SIEM, incident response, forensics, vulnerability management and automation.",
  },
  {
    id: 5,
    code: "5.0",
    name: "Security Program Management and Oversight",
    shortName: "Program Management",
    slug: "security-program-management",
    weight: 20,
    description: "Governance, risk management, compliance, third-party risk, audits and security awareness.",
  },
] as const;

export const DOMAIN_IDS: readonly DomainId[] = [1, 2, 3, 4, 5];

const byId = new Map(DOMAINS.map((d) => [d.id, d]));
const bySlug = new Map(DOMAINS.map((d) => [d.slug, d]));

export function getDomain(id: DomainId): Domain {
  const domain = byId.get(id);
  if (!domain) throw new Error(`Unknown domain ${id}`);
  return domain;
}

export function getDomainBySlug(slug: string): Domain | undefined {
  return bySlug.get(slug);
}

export function isDomainId(value: unknown): value is DomainId {
  return typeof value === "number" && byId.has(value as DomainId);
}

/**
 * Resolve loose domain references used in imports: 1-5, "4", "4.0",
 * a full name, a short name, or a slug (case-insensitive).
 */
export function resolveDomain(value: unknown): DomainId | null {
  if (typeof value === "number") return isDomainId(value) ? value : null;
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  const numeric = Number.parseFloat(raw.replace(/^domain\s*/, ""));
  if (/^(domain\s*)?\d(\.0)?$/.test(raw) && isDomainId(numeric)) return numeric;
  const normalize = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const target = normalize(raw);
  for (const d of DOMAINS) {
    if ([d.name, d.shortName, d.slug].some((n) => normalize(n) === target)) return d.id;
  }
  // Tolerate common abbreviations such as "Threats/Vulnerabilities" or "Program Management".
  for (const d of DOMAINS) {
    if (normalize(d.name).startsWith(target) || normalize(d.shortName) === target) return d.id;
  }
  return null;
}
