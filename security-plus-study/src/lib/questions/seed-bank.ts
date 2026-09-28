import "server-only";

import d1 from "../../../data/questions/domain-1-general-security-concepts.json";
import d2 from "../../../data/questions/domain-2-threats-vulnerabilities-mitigations.json";
import d3 from "../../../data/questions/domain-3-security-architecture.json";
import d4 from "../../../data/questions/domain-4-security-operations.json";
import d5 from "../../../data/questions/domain-5-program-management.json";
import { buildSeedBank } from "./seed-builder";

/** The bundled starter question bank, normalized into Question records with stable ids. */
export function loadSeedBank() {
  return buildSeedBank([d1, d2, d3, d4, d5]);
}
