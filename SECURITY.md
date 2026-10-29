# Security Policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (private vulnerability reporting). If that option is unavailable, contact the maintainer, Clement Deust, by email at the address on his GitHub profile.

Please include: the affected component (`proxy`, `gateway`, `services/memory`, `worker`, `data`), the version or commit, steps to reproduce, and the impact you observed. We aim to acknowledge a report within 5 working days.

## Scope and design notes

- Only the proxy is exposed. The gateway authenticates and audits every call.
- Workers run in read-only, capability-dropped, non-root containers on an isolated network; no secret is placed in a worker. See `docs/infrastructure.md`.
- Only the `data` component accesses the database, through typed operations.
- Secrets never belong in the repository. If you find one, report it as above.

## Supported versions

The project is pre-release; only the default branch is supported.
