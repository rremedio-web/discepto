# Security Policy

## Supported versions

This is an experimental research reference. Only the latest commit on `main` receives maintenance.

## Reporting a vulnerability

Please report security issues privately to the maintainers via GitHub Security Advisories on the public repository. Do not open public issues for undisclosed vulnerabilities.

## Scope

This repository contains synthetic fixtures, offline replay logic, and structural release checks only. It does not run agents, access credentials, or perform network operations during normal use.

Release checks scan for credential-shaped patterns (including quoted JSON/YAML/TOML-style assignments), unexpected binary file types, NUL bytes, and invalid UTF-8. These checks are heuristic and do not replace secret scanning in private CI.

## Out of scope

- Effectiveness claims for multi-agent coordination in production
- Third-party model provider security
- Deployments that extend this kit with live agent execution
- Filesystem-byte attestation or actor-label authentication via trace binding
