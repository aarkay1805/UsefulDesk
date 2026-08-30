# Security Policy

Thank you for helping keep UsefulDesk and the gyms using it safe.

## Reporting a vulnerability

Do not open a public issue for a security bug. Report it privately through
[GitHub Security
Advisories](https://github.com/aarkay1805/UsefulDesk/security/advisories/new).
This is the canonical security-reporting channel for the project.

Include, when possible:

- a description of the issue and its impact;
- minimal reproduction steps or a proof of concept;
- the commit or deployment surface you tested;
- whether you want public credit or prefer to remain anonymous.

Do not include real member data, production tokens, provider credentials, or
destructive proof-of-concept actions. A maintainer may ask for additional
details inside the private advisory.

## Response targets

- Acknowledgement within 72 hours.
- Initial assessment within one week.
- A coordinated fix and disclosure timeline proportional to severity.

These are response targets, not a guarantee that every report is a confirmed
vulnerability.

## Scope

In scope:

- code and configuration in `aarkay1805/UsefulDesk`;
- authentication, authorization, RLS, webhook, payment, messaging, public API,
  scheduled-worker, and secret-handling behavior;
- default documentation that would lead an operator to deploy an unsafe
  configuration.

Out of scope:

- vulnerabilities in Supabase, Next.js, Node.js, Meta, Razorpay, Vercel, or
  other upstream services that do not arise from UsefulDesk's integration;
- issues that require an already compromised deployment unless they increase
  the blast radius;
- social engineering, physical attacks, denial-of-service testing, or changes
  to real gym/member records.

## Safe harbor

Good-faith research under this policy is authorized when it avoids privacy
violations, data destruction, service disruption, and exploitation beyond what
is necessary to demonstrate the issue. Give the maintainer reasonable time to
investigate and fix a confirmed issue before public disclosure.
