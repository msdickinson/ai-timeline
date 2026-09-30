/**
 * Secret redaction — masks API keys, tokens, passwords, and other sensitive data.
 * Applied before sharing/exporting sessions.
 */

const PATTERNS: Array<{ regex: RegExp; label: string }> = [
  // API keys — common prefixes
  { regex: /\b(sk-[a-zA-Z0-9]{20,})/g, label: "API key" },
  { regex: /\b(sk-ant-[a-zA-Z0-9-]{20,})/g, label: "Anthropic key" },
  { regex: /\b(sk-proj-[a-zA-Z0-9-]{20,})/g, label: "OpenAI key" },
  { regex: /\b(gsk_[a-zA-Z0-9]{20,})/g, label: "Groq key" },
  { regex: /\b(xai-[a-zA-Z0-9]{20,})/g, label: "xAI key" },
  { regex: /\b(AIzaSy[a-zA-Z0-9_-]{33})/g, label: "Google API key" },
  { regex: /\b(ghp_[a-zA-Z0-9]{36})/g, label: "GitHub PAT" },
  { regex: /\b(gho_[a-zA-Z0-9]{36})/g, label: "GitHub OAuth" },
  { regex: /\b(github_pat_[a-zA-Z0-9_]{82})/g, label: "GitHub fine-grained PAT" },
  { regex: /\b(glpat-[a-zA-Z0-9_-]{20,})/g, label: "GitLab PAT" },
  { regex: /\b(npm_[a-zA-Z0-9]{36})/g, label: "npm token" },
  { regex: /\b(AKIA[0-9A-Z]{16})/g, label: "AWS access key" },
  { regex: /\b(eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})/g, label: "JWT" },

  // Connection strings
  { regex: /(mongodb(\+srv)?:\/\/[^\s"']+)/g, label: "MongoDB URI" },
  { regex: /(postgres(ql)?:\/\/[^\s"']+)/g, label: "Postgres URI" },
  { regex: /(mysql:\/\/[^\s"']+)/g, label: "MySQL URI" },
  { regex: /(redis:\/\/[^\s"']+)/g, label: "Redis URI" },

  // Common secret patterns in config files
  { regex: /(password|passwd|pwd|secret|token|apikey|api_key|api-key|access_token|auth_token)\s*[:=]\s*["']([^"']{8,})["']/gi, label: "credential" },

  // Private keys
  { regex: /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g, label: "private key" },

  // IP addresses with ports (likely internal infra)
  { regex: /\b(192\.168\.\d{1,3}\.\d{1,3}:\d{2,5})\b/g, label: "internal address" },
  { regex: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5})\b/g, label: "internal address" },
];

/** Redact sensitive data from a string, replacing matches with [REDACTED: label] */
export function redactString(text: string): string {
  let result = text;
  for (const { regex, label } of PATTERNS) {
    // Reset regex state for global patterns
    regex.lastIndex = 0;
    result = result.replace(regex, `[REDACTED: ${label}]`);
  }
  return result;
}

/** Count how many secrets were found in a string */
export function countSecrets(text: string): number {
  let count = 0;
  for (const { regex } of PATTERNS) {
    regex.lastIndex = 0;
    const matches = text.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}
