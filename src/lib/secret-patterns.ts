/**
 * Secret pattern set — FR-K1-7 / FR-SEC-4 (Secret Shield).
 *
 * K-1 SHALL reject persistence of payloads matching the secret-pattern set,
 * journaling the rejection as `journal.append_rejected`. Secrets MUST NOT
 * persist in K-1.
 *
 * Patterns are conservative, high-precision regexes targeting common secret
 * formats. False negatives (missed secrets) are a risk we accept over false
 * positives (blocking legitimate content). The set is extensible via policy
 * data (C-11) but the kernel ships a non-empty baseline.
 *
 * @forge-trace {"component_id":"lib-secret-patterns","problems":["P83"],"heritage":["K14"],"decisions":["DEC-01"],"bp_ids":[],"ac_ids":[]}
 */

export interface SecretMatch {
  /** The pattern id that matched. */
  patternId: string;
  /** The matched substring (truncated for safe logging). */
  snippet: string;
}

// Each pattern is anchored to avoid matching arbitrary long strings.
// We search the canonical JSON string representation of the payload.
const PATTERNS: { id: string; re: RegExp }[] = [
  // AWS Access Key ID: AKIA followed by 16 uppercase alphanumerics
  { id: 'aws-access-key-id', re: /AKIA[0-9A-Z]{16}/ },
  // AWS Secret Access Key: 40-char base64-ish, prefixed for precision
  { id: 'aws-secret-key', re: /aws_secret_access_key["'\s:=]+([A-Za-z0-9/+=]{40})/i },
  // GitHub PAT (classic): ghp_ + 36 chars; (fine-grained): github_pat_ + 82
  { id: 'github-pat', re: /gh[ps]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}/ },
  // Generic high-entropy API key: sk_live_ / sk_test_ / rk_live_ (Stripe-style)
  { id: 'stripe-key', re: /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/ },
  // Private key headers (PEM)
  { id: 'pem-private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  // JWT: three base64url segments separated by dots (min 20 chars each)
  { id: 'jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // Slack token: xoxb- / xoxp- / xoxa-
  { id: 'slack-token', re: /xox[abp]-[0-9A-Za-z-]{10,}/ },
  // Google API key: AIza + 35 chars
  { id: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/ },
];

/**
 * Scan a string for secret patterns. Returns the first match, or null.
 * FR-K1-7: secrets MUST NOT persist in K-1.
 */
export function scanForSecrets(text: string): SecretMatch | null {
  for (const { id, re } of PATTERNS) {
    const m = re.exec(text);
    if (m && m[0]) {
      return {
        patternId: id,
        snippet: m[0].slice(0, 24) + (m[0].length > 24 ? '…' : ''),
      };
    }
  }
  return null;
}

/**
 * List the registered pattern ids (for transparency / audit).
 */
export function registeredSecretPatternIds(): string[] {
  return PATTERNS.map((p) => p.id);
}
