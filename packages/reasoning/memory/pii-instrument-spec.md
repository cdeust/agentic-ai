# PII/Secret Scanner — Instrument Specification

**Status**: binding for `memory-tool.sh §7.2` implementation.
**Revision**: 2026-04-24

---

## 1. Instrument definition (Move 1)

| Attribute          | Value |
|--------------------|-------|
| Apparatus          | `pii_scan` bash function, delegating to embedded Python 3 with `pii-rules.json` rule table |
| Reading            | `pass` \| `blocked:<rule_id>` |
| Unit               | Classification result per write operation |
| Zero calibration   | Output `pass` on empty string input |
| Scale              | Binary per rule class; `blocked` when any rule fires with confidence ≥ threshold |
| Noise floor        | Measured as false-positive rate (FPR) on 100-fixture benign corpus (see §4) |

---

## 2. Pattern classes and exact regexes

All regexes are stored in `memory/pii-rules.json` (curator-editable without touching the tool). This document is the specification. The JSON file is the implementation.

### High-confidence classes (block on match, no entropy gate)

| Class ID | Description | Source |
|----------|-------------|--------|
| `aws_access_key` | AWS Access Key ID — `(A3T[A-Z0-9]\|AKIA\|ABIA\|ACCA\|ASIA)[A-Z0-9]{16}` | AWS IAM Identifier Reference |
| `github_pat` | GitHub PAT — `gh[pousr]_[A-Za-z0-9_]{36,255}` | GitHub token format docs |
| `private_key_header` | PEM block — `-----BEGIN [A-Z ]*PRIVATE KEY-----` | RFC 7468 |
| `ssh_private_key` | OpenSSH key — `-----BEGIN OPENSSH PRIVATE KEY-----` | OpenSSH PROTOCOL.key |
| `jwt` | RFC 7519 §3.1 three-segment base64url — `eyJ...eyJ...<sig>` | RFC 7519 |
| `slack_token` | `xox[bpso]-...` | Slack token type docs |
| `stripe_key` | `(sk\|pk)_(live\|test)_...` | Stripe API key docs |
| `gcp_service_account` | JSON `"type": "service_account"` | GCP service account key docs |

### High-confidence classes with entropy gate

| Class ID | Description | Entropy gate |
|----------|-------------|-------------|
| `aws_secret_key` | 40-char base64 after AWS secret assignment | H > 3.5 bits/char on matched group |
| `azure_connection_str` | `AccountKey=<86-char base64>==` | H > 3.5 bits/char on key portion |

### Medium-confidence classes

| Class ID | Description | Entropy gate |
|----------|-------------|-------------|
| `generic_api_key` | Key-named variable = 32–64 char opaque value | H > 3.5 bits/char (excludes `YOUR_API_KEY_HERE` placeholders) |
| `us_ssn` | NNN-NN-NNNN excluding invalid prefixes | none |

### Low-confidence classes (block only if `MEMORY_PII_STRICT=1`)

| Class ID | Description |
|----------|-------------|
| `email_address` | RFC 5321 simplified: `[\\w.+-]+@[\\w-]+\\.[a-z]{2,}` |
| `us_phone` | NANP format with optional +1 |

---

## 3. Entropy threshold — source and rationale

**Threshold**: 3.5 bits/char (Shannon H).

**Source**: Shannon, C. E. (1948). "A Mathematical Theory of Communication." *Bell System Technical Journal* 27(3), 379–423. Operational threshold value sourced from TruffleHog v2 design (Cornwell, T., 2019, trufflesecurity/trufflehog) — the 3.5 threshold is empirically calibrated to exclude placeholders (H ≈ 1.5–2.5 bits/char for strings like `YOUR_API_KEY_HERE`) while catching real key material (H ≈ 4.5–6.0 bits/char for randomly generated secrets).

**Formula**: H = −∑ p_i log₂ p_i over the character frequency histogram of the matched substring.

**Applies to**: `aws_secret_key`, `azure_connection_str`, `generic_api_key` (classes where FP risk from placeholder strings is highest).

---

## 4. Noise-floor measurement procedure

### Corpus

100 fixtures of intentionally benign memory-file content are defined in `scripts/test-memory-pii.sh`:
- Architecture notes, ADR entries, code snippets
- Agent decision logs, benchmark results
- Placeholder strings (e.g. `YOUR_KEY`, `<token>`, `example.com`)
- Hex strings, base64 that are not secrets
- Normal prose with email-like patterns in documentation context

### Measurement run

```
bash scripts/test-memory-pii.sh 2>&1 | grep "^CORPUS:"
```

Reports: `CORPUS: N_total fixtures — FPR=X% FNR=Y%`

### Calibration procedure

For any class whose FPR > 5% on the benign corpus:
1. Identify the failing fixtures
2. Tighten the regex (anchor, require context, add negative lookahead)
3. Re-run the corpus
4. Iterate until FPR ≤ 5%
5. Document final state here

### Baseline (2026-04-24, after initial calibration)

See `scripts/test-memory-pii.sh` output for live numbers. Classes with **unknowable real-world FPR** without a larger production corpus are flagged below.

| Class | Corpus FPR | Real-world FPR | Calibrated? |
|-------|-----------|----------------|-------------|
| `aws_access_key` | 0% | low (prefix is distinctive) | yes |
| `aws_secret_key` | 0% | low (entropy gate + context) | yes |
| `github_pat` | 0% | low (prefix is distinctive) | yes |
| `private_key_header` | 0% | near-zero | yes |
| `ssh_private_key` | 0% | near-zero | yes |
| `jwt` | 0% | low (eyJ prefix is very distinctive) | yes |
| `slack_token` | 0% | low | yes |
| `stripe_key` | 0% | low | yes |
| `gcp_service_account` | 0% | low | yes |
| `azure_connection_str` | 0% | low (entropy gate) | yes |
| `generic_api_key` | TBD | **UNKNOWABLE** without production corpus — variable names in code snippets can match; entropy gate reduces but does not eliminate FP | flag |
| `email_address` | TBD | **UNKNOWABLE** — low-confidence class; only blocks in STRICT mode by design | flag |
| `us_ssn` | TBD | **UNKNOWABLE** — digit sequences in benchmarks, dates, version numbers can collide | flag |
| `us_phone` | TBD | **UNKNOWABLE** — only blocks in STRICT mode by design | flag |

---

## 5. Override flags

| Flag | Effect |
|------|--------|
| `MEMORY_PII_SCAN_DISABLE=1` | Bypasses scan entirely; write proceeds; audit logs `pii_scan_disabled` |
| `MEMORY_PII_STRICT=1` | Promotes low-confidence classes to blocking; enables email and phone blocking |
| (default) | High + medium classes block; low-confidence classes are silently noted in audit only |

---

## 6. Back-action audit (Move 7 / observer-effect check)

**Does the scan perturb the system?**

- The scanner reads `content` in memory only; writes nothing derived from content.
- The audit log records only the matched rule ID (`aws_access_key` etc.) — NEVER the matched bytes. Logging the secret would be worse than not detecting it.
- The scan is read-only with respect to all files. `pii_scan_error` path allows the write through, preventing the scanner itself from being a DoS vector.
- Scan latency is measured in `scripts/test-memory-pii.sh` against a ~10 KB fixture. Measured baseline on macOS Apple Silicon: ~65 ms (dominated by Python 3 interpreter startup, not scanner logic). The 50 ms target is not met on cold-start; warm Python processes are negligible. If latency is unacceptable, the scanner should be converted to a persistent subprocess. This is documented here; the implementation proceeds with the current approach as the overhead only applies to write operations (not reads or searches).

**Inert substrate control**: `scripts/test-memory-pii.sh` runs the scanner on benign content (the control substrate) and confirms zero false blocks before running the true-positive suite.
