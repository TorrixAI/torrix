# Security policy

## Reporting a vulnerability

Please do not report security problems in public issues.

Use GitHub's private vulnerability reporting: open the **Security** tab of this repository and click
**Report a vulnerability**. Include what you found, how to reproduce it, and the impact you see.

We will acknowledge your report within three working days, keep you updated while we work on a fix,
and credit you in the release notes if you would like.

## Supported versions

Security fixes are made for the latest release. Please upgrade before reporting, in case the problem
is already fixed.

## Scope

In scope: the Torrix server and console, the SDKs, the Claude Code and opencode plugins, the Helm
chart and the install script in this repository.

Out of scope: problems that need an attacker to already have an administrator account or access to
the server's files, and findings in third-party providers that Torrix forwards calls to.
