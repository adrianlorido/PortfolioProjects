import type { DomainId, Topic } from "@/lib/types";

interface TopicDefinition extends Topic {
  /** Domain the topic most commonly appears under (topics may still span domains). */
  domainHint: DomainId;
  /** Extra search keywords: acronyms, expansions, related terms. */
  keywords?: string[];
}

/**
 * Canonical topic taxonomy. Imports may introduce new topics; these are the
 * curated ones with friendly names and search keywords.
 */
export const TOPICS: readonly TopicDefinition[] = [
  // Domain 1
  { id: "security-controls", name: "Security Controls", domainHint: 1, keywords: ["preventive", "detective", "corrective", "compensating", "deterrent", "technical", "managerial", "operational", "physical"] },
  { id: "cia-triad", name: "CIA Triad", domainHint: 1, keywords: ["confidentiality", "integrity", "availability"] },
  { id: "aaa", name: "AAA", domainHint: 1, keywords: ["authentication", "authorization", "accounting"] },
  { id: "zero-trust", name: "Zero Trust", domainHint: 1, keywords: ["policy engine", "policy enforcement point", "pep", "pdp", "control plane", "data plane"] },
  { id: "physical-security", name: "Physical Security", domainHint: 1, keywords: ["bollards", "access control vestibule", "mantrap", "badge"] },
  { id: "deception", name: "Deception & Disruption", domainHint: 1, keywords: ["honeypot", "honeynet", "honeytoken", "honeyfile"] },
  { id: "change-management", name: "Change Management", domainHint: 1, keywords: ["cab", "backout plan", "maintenance window"] },
  { id: "pki", name: "PKI", domainHint: 1, keywords: ["public key infrastructure", "ca", "certificate authority", "ocsp", "crl"] },
  { id: "certificates", name: "Certificates", domainHint: 1, keywords: ["x.509", "csr", "wildcard", "san", "ocsp stapling", "pinning"] },
  { id: "encryption", name: "Encryption", domainHint: 1, keywords: ["aes", "rsa", "symmetric", "asymmetric", "ecc", "tls", "full disk encryption"] },
  { id: "hashing", name: "Hashing", domainHint: 1, keywords: ["sha-256", "md5", "salt", "hmac", "integrity"] },
  { id: "digital-signatures", name: "Digital Signatures", domainHint: 1, keywords: ["non-repudiation", "signing", "private key"] },
  { id: "key-management", name: "Key Management", domainHint: 1, keywords: ["hsm", "tpm", "key escrow", "kms", "secure enclave"] },
  { id: "obfuscation", name: "Obfuscation", domainHint: 1, keywords: ["steganography", "tokenization", "data masking"] },
  // Domain 2
  { id: "threat-actors", name: "Threat Actors", domainHint: 2, keywords: ["nation-state", "apt", "hacktivist", "insider threat", "unskilled attacker", "organized crime", "shadow it"] },
  { id: "social-engineering", name: "Social Engineering", domainHint: 2, keywords: ["phishing", "vishing", "smishing", "pretexting", "watering hole", "typosquatting", "bec"] },
  { id: "malware", name: "Malware", domainHint: 2, keywords: ["ransomware", "trojan", "worm", "rootkit", "keylogger", "logic bomb", "spyware", "fileless"] },
  { id: "attack-vectors", name: "Attack Vectors", domainHint: 2, keywords: ["attack surface", "supply chain", "removable media", "unsecure networks"] },
  { id: "vulnerabilities", name: "Vulnerabilities", domainHint: 2, keywords: ["zero-day", "misconfiguration", "race condition", "toctou", "memory injection", "legacy"] },
  { id: "application-attacks", name: "Application Attacks", domainHint: 2, keywords: ["sql injection", "sqli", "xss", "csrf", "buffer overflow", "directory traversal", "replay"] },
  { id: "network-attacks", name: "Network Attacks", domainHint: 2, keywords: ["ddos", "on-path", "dns poisoning", "arp", "evil twin", "amplification"] },
  { id: "password-attacks", name: "Password Attacks", domainHint: 2, keywords: ["password spraying", "brute force", "credential stuffing", "rainbow table"] },
  { id: "cryptographic-attacks", name: "Cryptographic Attacks", domainHint: 2, keywords: ["downgrade", "collision", "birthday attack"] },
  { id: "indicators-of-compromise", name: "Indicators of Compromise", domainHint: 2, keywords: ["ioc", "impossible travel", "account lockout", "resource consumption"] },
  { id: "mitigation-techniques", name: "Mitigation Techniques", domainHint: 2, keywords: ["least privilege", "patching", "isolation", "allow list", "decommissioning"] },
  // Domain 3
  { id: "cloud-security", name: "Cloud Security", domainHint: 3, keywords: ["iaas", "paas", "saas", "shared responsibility", "casb", "iac", "serverless"] },
  { id: "virtualization", name: "Virtualization", domainHint: 3, keywords: ["vm escape", "hypervisor", "containers", "vm sprawl"] },
  { id: "network-security", name: "Network Security", domainHint: 3, keywords: ["jump server", "proxy", "load balancer", "802.1x", "nac", "sd-wan", "sase"] },
  { id: "firewalls", name: "Firewalls", domainHint: 3, keywords: ["waf", "ngfw", "utm", "acl", "stateful"] },
  { id: "ids-ips", name: "IDS/IPS", domainHint: 3, keywords: ["intrusion detection", "intrusion prevention", "signature", "anomaly", "inline", "tap"] },
  { id: "segmentation", name: "Segmentation", domainHint: 3, keywords: ["vlan", "dmz", "screened subnet", "microsegmentation", "air gap"] },
  { id: "vpn", name: "VPN & Remote Access", domainHint: 3, keywords: ["ipsec", "tls vpn", "split tunnel", "full tunnel"] },
  { id: "data-protection", name: "Data Protection", domainHint: 3, keywords: ["data at rest", "data in transit", "data in use", "classification", "data sovereignty"] },
  { id: "resilience", name: "Resilience", domainHint: 3, keywords: ["high availability", "clustering", "load balancing", "ups", "generator", "redundancy"] },
  { id: "backups", name: "Backups", domainHint: 3, keywords: ["snapshot", "replication", "incremental", "differential", "offsite", "immutable"] },
  { id: "disaster-recovery", name: "Disaster Recovery", domainHint: 3, keywords: ["hot site", "warm site", "cold site", "failover", "tabletop"] },
  { id: "iot-ics", name: "IoT & ICS/SCADA", domainHint: 3, keywords: ["scada", "ics", "rtos", "embedded", "iot"] },
  // Domain 4
  { id: "iam", name: "IAM", domainHint: 4, keywords: ["identity and access management", "provisioning", "deprovisioning", "pam", "privileged access"] },
  { id: "authentication", name: "Authentication", domainHint: 4, keywords: ["mfa", "passwordless", "biometrics", "fido2", "totp"] },
  { id: "federation", name: "Federation", domainHint: 4, keywords: ["saml", "idp", "identity provider", "oidc", "trust"] },
  { id: "sso", name: "SSO", domainHint: 4, keywords: ["single sign-on", "kerberos", "ldap"] },
  { id: "radius", name: "RADIUS", domainHint: 4, keywords: ["remote authentication dial-in user service", "802.1x", "udp"] },
  { id: "tacacs", name: "TACACS+", domainHint: 4, keywords: ["terminal access controller", "device administration", "tcp 49"] },
  { id: "access-control-models", name: "Access Control Models", domainHint: 4, keywords: ["rbac", "abac", "mac", "dac", "rule-based"] },
  { id: "incident-response", name: "Incident Response", domainHint: 4, keywords: ["containment", "eradication", "recovery", "lessons learned", "playbook"] },
  { id: "siem", name: "SIEM", domainHint: 4, keywords: ["security information and event management", "correlation", "alert tuning"] },
  { id: "logging", name: "Logging & Monitoring", domainHint: 4, keywords: ["syslog", "netflow", "log aggregation", "metadata"] },
  { id: "forensics", name: "Digital Forensics", domainHint: 4, keywords: ["chain of custody", "legal hold", "order of volatility", "write blocker", "e-discovery"] },
  { id: "vulnerability-management", name: "Vulnerability Management", domainHint: 4, keywords: ["cvss", "cve", "vulnerability scan", "false positive", "remediation"] },
  { id: "hardening", name: "Hardening", domainHint: 4, keywords: ["baseline", "cis benchmark", "disable services", "default credentials"] },
  { id: "endpoint-security", name: "Endpoint Security", domainHint: 4, keywords: ["edr", "xdr", "hids", "antivirus", "mdm"] },
  { id: "email-security", name: "Email Security", domainHint: 4, keywords: ["spf", "dkim", "dmarc", "secure email gateway"] },
  { id: "wireless-security", name: "Wireless Security", domainHint: 4, keywords: ["wpa3", "sae", "eap", "wps", "site survey"] },
  { id: "automation", name: "Automation & Orchestration", domainHint: 4, keywords: ["soar", "scripting", "runbook", "ci/cd"] },
  { id: "asset-management", name: "Asset Management", domainHint: 4, keywords: ["inventory", "sanitization", "destruction", "certificate of destruction"] },
  { id: "secure-protocols", name: "Secure Protocols", domainHint: 4, keywords: ["ssh", "sftp", "https", "ldaps", "snmpv3", "dnssec"] },
  { id: "application-security", name: "Application Security", domainHint: 4, keywords: ["input validation", "sast", "dast", "code signing", "sandboxing", "secure cookies"] },
  { id: "dlp", name: "DLP", domainHint: 4, keywords: ["data loss prevention", "exfiltration"] },
  // Domain 5
  { id: "governance", name: "Governance", domainHint: 5, keywords: ["policy", "standard", "procedure", "guideline", "aup", "board"] },
  { id: "risk-management", name: "Risk Management", domainHint: 5, keywords: ["ale", "sle", "aro", "risk register", "risk appetite", "transfer", "avoid", "accept", "mitigate"] },
  { id: "compliance", name: "Compliance", domainHint: 5, keywords: ["regulation", "attestation", "sanctions", "due diligence", "due care"] },
  { id: "vendor-management", name: "Vendor Management", domainHint: 5, keywords: ["third-party risk", "sla", "msa", "mou", "moa", "nda", "bpa", "sow", "right to audit"] },
  { id: "penetration-testing", name: "Penetration Testing", domainHint: 5, keywords: ["pentest", "known environment", "unknown environment", "partially known", "red team"] },
  { id: "rules-of-engagement", name: "Rules of Engagement", domainHint: 5, keywords: ["roe", "scope", "authorization", "testing window"] },
  { id: "audits", name: "Audits & Assessments", domainHint: 5, keywords: ["internal audit", "external audit", "self-assessment", "attestation"] },
  { id: "security-awareness", name: "Security Awareness", domainHint: 5, keywords: ["training", "phishing simulation", "anomalous behavior"] },
  { id: "business-impact-analysis", name: "Business Impact Analysis", domainHint: 5, keywords: ["bia", "rto", "rpo", "mttr", "mtbf"] },
  { id: "data-privacy", name: "Data Privacy", domainHint: 5, keywords: ["data controller", "data processor", "data subject", "right to be forgotten", "pii"] },
];

const topicById = new Map(TOPICS.map((t) => [t.id, t]));

export function slugifyTopic(name: string): string {
  return name
    .toLowerCase()
    .replace(/\+/g, "-plus")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const aliasIndex = (() => {
  const index = new Map<string, string>();
  for (const t of TOPICS) {
    index.set(t.id, t.id);
    index.set(slugifyTopic(t.name), t.id);
  }
  // Friendly aliases used by common question generators.
  const aliases: Record<string, string> = {
    "tacacs-plus": "tacacs",
    "ids": "ids-ips",
    "ips": "ids-ips",
    "ids-and-ips": "ids-ips",
    "logging-and-monitoring": "logging",
    "monitoring": "logging",
    "digital-forensics": "forensics",
    "identity-and-access-management": "iam",
    "single-sign-on": "sso",
    "public-key-infrastructure": "pki",
    "mfa": "authentication",
    "multifactor-authentication": "authentication",
    "backup": "backups",
    "dr": "disaster-recovery",
    "bia": "business-impact-analysis",
    "risk": "risk-management",
    "third-party-risk": "vendor-management",
    "pen-testing": "penetration-testing",
    "pentesting": "penetration-testing",
    "roe": "rules-of-engagement",
    "cloud": "cloud-security",
    "network": "network-security",
    "soar": "automation",
    "data-loss-prevention": "dlp",
    "iot": "iot-ics",
    "ics": "iot-ics",
    "scada": "iot-ics",
    "vpn-and-remote-access": "vpn",
    "deception-and-disruption": "deception",
    "audits-and-assessments": "audits",
    "automation-and-orchestration": "automation",
    "iot-and-ics-scada": "iot-ics",
  };
  for (const [alias, id] of Object.entries(aliases)) index.set(alias, id);
  return index;
})();

/** Map any topic label to a canonical topic, or create an ad-hoc topic from the label. */
export function resolveTopic(label: string): Topic {
  const slug = slugifyTopic(label);
  const canonicalId = aliasIndex.get(slug);
  if (canonicalId) {
    const def = topicById.get(canonicalId)!;
    return { id: def.id, name: def.name };
  }
  return { id: slug, name: label.trim() };
}

export function getTopicName(id: string, fallback?: Map<string, string>): string {
  return topicById.get(id)?.name ?? fallback?.get(id) ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getTopicKeywords(id: string): string[] {
  return topicById.get(id)?.keywords ?? [];
}

export function getTopicDefinition(id: string): TopicDefinition | undefined {
  return topicById.get(id);
}
