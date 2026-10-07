# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through **Security → Report a vulnerability** on this repository, with the steps to reproduce it. You will get an answer within a few days, and credit in the release notes if you want it.

## Supported versions

Only the latest release gets security fixes. XWinCode updates itself, so staying current only takes a restart.

## How XWinCode protects you

- **Restricted Mode.** Opening a Swift package lets SourceKit-LSP and the build tools run the code in its `Package.swift`. XWinCode therefore asks before it trusts a project it did not create: until you say yes, you can read and edit the files, but nothing in the project runs.
- **Signed updates.** Every update is signed, and XWinCode refuses to install one whose signature does not match the public key built into the app. Each signature is bound to its version, so an older release cannot be served as a newer one.
- **A signing key kept apart.** Releases are built in one job and signed in another, which never installs the project's dependencies, so build-time code never sees the signing key.
- **Locked-down interface.** The interface runs under a strict Content Security Policy: no remote scripts, no inline scripts, no `eval`. It cannot navigate away from the app; web links open in your browser.
- **No network listener.** The iPhone bridge between Windows and WSL goes through a private Unix socket inside WSL and standard input/output on Windows. No port is opened and no firewall rule is added.
- **Your Apple ID stays yours.** Your Apple ID password is typed into xtool's own window and never passes through XWinCode.
- **Checked inputs.** Device identifiers, bundle IDs, distribution names and paths are validated or quoted before they reach a shell, paths from `xtool.yml` cannot leave the project, and system tools always start from `System32`.
- **Audited dependencies.** CI runs `npm audit` and the test suite on every push, and Dependabot keeps dependencies and pinned GitHub Actions up to date.
