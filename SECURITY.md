# Security policy

emcc is a mock-up of a command and control system, made to show what AI agents can build. It is not made or tested for operational use, and it holds no real data. Run it on networks and with data you trust.

## Supported versions

Only the latest release gets fixes. Older releases are not updated.

## Reporting a vulnerability

Please do not report a vulnerability in a public issue. Send it by email to **andreas@emcc.dev**, with:

- the release (its name, e.g. `emcc-M9-2026-11-19-788ce01d`, or the commit);
- what an attacker can do, and how to reproduce it;
- whether it needs a login, and which permissions.

You will get an answer when the report has been read. A fix, if one is made, comes in a later release, and the report is credited there unless you ask otherwise. There is no bug bounty.

## Scope

In scope: the emcc server, its plugins and the web client in this repository, and the release built from it.

Out of scope: external systems that emcc connects to (for example a TAK server, a WMS server or an identity provider), the demo logins of a local test setup, and denial of service by an admin's own settings.
