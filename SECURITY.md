# Security Policy

## Supported versions

Only the latest release published on npm receives fixes. Releases are cut
automatically from `main`, so a fix ships as soon as it is merged.

| Version         | Supported |
| --------------- | --------- |
| latest `1.x`    | Yes       |
| anything older  | No        |

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for security
problems.**

Report it privately through GitHub's private vulnerability reporting:

1. Go to <https://github.com/LukastBorges/biome-plugin-tanstack-query/security/advisories/new>
   (repository **Security** tab, then **Report a vulnerability**).
2. Describe the issue, the affected version(s) and, if possible, a minimal
   reproduction.

You can expect an acknowledgement within **3 working days** and a status
update (accepted, needs more information, or declined with reasoning) within
**10 working days**. Accepted reports are fixed in a private fork, released,
and then disclosed through a GitHub Security Advisory (with a CVE where
applicable). Reporters are credited unless they ask not to be.

## Scope

This package ships GritQL (`.grit`) files that Biome loads as lint plugins; it
contains no executable JavaScript. Relevant reports include, for example:

- a rule whose **automatic fix** (`biome lint --write`) silently changes the
  behaviour of correct code in a way that could introduce a vulnerability;
- a pattern that makes Biome hang or crash on crafted input (denial of service
  in editors or CI);
- anything that compromises the **release pipeline**: the published tarball
  containing files other than `rules/*.grit`, `README.md`, `LICENSE` and
  `package.json`, a missing or mismatching provenance attestation, or a
  weakness in the GitHub Actions workflows.

False positives/negatives of a rule are not security issues. Please use the
[issue tracker](https://github.com/LukastBorges/biome-plugin-tanstack-query/issues/new/choose)
for those. Vulnerabilities in Biome itself belong to the
[Biome project](https://github.com/biomejs/biome/security).

## Verifying what you install

Every release is published from GitHub Actions with npm
[Trusted Publishing](https://docs.npmjs.com/trusted-publishers) and carries a
signed [provenance attestation](https://docs.npmjs.com/generating-provenance-statements)
linking the tarball to the exact commit and workflow run that built it. No
long-lived npm token exists for this package.

```sh
# In your project, after installing:
npm audit signatures
```

This verifies the registry signatures of every installed package and the
provenance attestations of those that have one, including
`biome-plugin-tanstack-query`. The npm package page also shows a
**Provenance** badge linking to the source commit and build.
