/**
 * Secret pattern set tests — FR-K1-7 / FR-SEC-4 (Secret Shield).
 *
 * Covers scanForSecrets for all 8 patterns + the negative case, and
 * registeredSecretPatternIds for the transparency/audit list.
 *
 * @forge-trace {"component_id":"test-secret-patterns","problems":["P83"],"heritage":["K14"],"decisions":["DEC-01"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import { scanForSecrets, registeredSecretPatternIds } from '../../src/lib/secret-patterns.js';

describe('registeredSecretPatternIds: transparency / audit list', () => {
  it('returns all 8 registered pattern ids', () => {
    const ids = registeredSecretPatternIds();
    expect(ids).toContain('aws-access-key-id');
    expect(ids).toContain('aws-secret-key');
    expect(ids).toContain('github-pat');
    expect(ids).toContain('stripe-key');
    expect(ids).toContain('pem-private-key');
    expect(ids).toContain('jwt');
    expect(ids).toContain('slack-token');
    expect(ids).toContain('google-api-key');
    expect(ids.length).toBe(8);
  });

  it('returns a defensive copy (mutating the result does not affect the registry)', () => {
    const ids = registeredSecretPatternIds();
    ids.length = 0;
    const ids2 = registeredSecretPatternIds();
    expect(ids2.length).toBe(8);
  });
});

describe('scanForSecrets: clean text returns null', () => {
  it('returns null for plain text with no secrets', () => {
    expect(scanForSecrets('just a normal note about the project')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(scanForSecrets('')).toBeNull();
  });

  it('returns null for text that mentions secret-like words but is not a secret', () => {
    expect(scanForSecrets('the AWS key is missing')).toBeNull();
  });
});

describe('scanForSecrets: detects each pattern (PROVOCATION)', () => {
  it('detects an AWS Access Key ID', () => {
    const m = scanForSecrets('AKIAIOSFODNN7EXAMPLE');
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('aws-access-key-id');
  });

  it('detects an AWS Secret Access Key', () => {
    const m = scanForSecrets('aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('aws-secret-key');
  });

  it('detects a GitHub classic PAT', () => {
    const m = scanForSecrets('ghp_1234567890abcdefghijklmnopqrstuvwxyzAB');
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('github-pat');
  });

  it('detects a GitHub fine-grained PAT', () => {
    // github_pat_ + exactly 82 chars of [A-Za-z0-9_]
    const m = scanForSecrets(
      'github_pat_11ABCDE0123456789_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01',
    );
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('github-pat');
  });

  it('detects a Stripe live key', () => {
    const m = scanForSecrets('sk_live_1234567890abcdefghijklmnopqrstuvwxyz');
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('stripe-key');
  });

  it('detects a Stripe test key', () => {
    const m = scanForSecrets('rk_test_1234567890abcdefghijklmnopqrstuvwxyz');
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('stripe-key');
  });

  it('detects a PEM RSA private key header', () => {
    const m = scanForSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIE...');
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('pem-private-key');
  });

  it('detects a PEM EC private key header', () => {
    const m = scanForSecrets('-----BEGIN EC PRIVATE KEY-----\nMHQ...');
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('pem-private-key');
  });

  it('detects a PEM OPENSSH private key header', () => {
    const m = scanForSecrets('-----BEGIN OPENSSH PRIVATE KEY-----\nb3Bl...');
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('pem-private-key');
  });

  it('detects a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef1234567890';
    const m = scanForSecrets(jwt);
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('jwt');
  });

  it('detects a Slack bot token', () => {
    const m = scanForSecrets('xoxb-1234567890-abcdefghij');
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('slack-token');
  });

  it('detects a Slack user token', () => {
    const m = scanForSecrets('xoxp-1234567890-abcdefghij');
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('slack-token');
  });

  it('detects a Google API key', () => {
    const m = scanForSecrets('AIzaSyD-abcdefghijklmnopqrstuvwxyz123456789');
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('google-api-key');
  });
});

describe('scanForSecrets: snippet truncation', () => {
  it('truncates long matches with an ellipsis for safe logging', () => {
    // A fine-grained GitHub PAT is 95 chars (github_pat_ + 82) — well over the 24-char snippet limit.
    const longPat =
      'github_pat_11ABCDE0123456789_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01';
    const m = scanForSecrets(longPat);
    expect(m).not.toBeNull();
    expect(m!.snippet.length).toBeLessThanOrEqual(25); // 24 chars + ellipsis
    expect(m!.snippet.endsWith('…')).toBe(true);
  });

  it('does not truncate short matches', () => {
    const m = scanForSecrets('AKIAIOSFODNN7EXAMPLE');
    expect(m).not.toBeNull();
    expect(m!.snippet.endsWith('…')).toBe(false);
  });
});

describe('scanForSecrets: returns the FIRST match only', () => {
  it('when multiple secrets are present, returns the first pattern in registry order', () => {
    // AWS access key id is pattern[0]; embed it alongside a PEM key.
    const text = 'AKIAIOSFODNN7EXAMPLE and -----BEGIN RSA PRIVATE KEY-----';
    const m = scanForSecrets(text);
    expect(m).not.toBeNull();
    expect(m!.patternId).toBe('aws-access-key-id');
  });
});
