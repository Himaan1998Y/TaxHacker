# Findings and Decisions

## Requirements
- Gather as much actionable context as possible about the TaxHacker product and repository.
- Build persistent on-disk context so work can continue smoothly in follow-up sessions.
- Cover product behavior plus technical internals, not just README-level summary.

## Research Findings
- Repository currently has a non-clean worktree with broad edits across auth, agent routes, settings actions/pages, files, and package manifests.
- Existing state suggests active self-hosting/auth and agent-related development is underway.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Start with top-level architecture + key config docs, then drill into runtime modules | Fastest path to high-confidence mental model |
| Track current modified files early | Prevents confusion between baseline behavior and in-progress changes |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Skill catch-up script returned no report output | Continued with explicit manual recon and structured logs |

## Resources
- README.md
- docker-compose.yml
- Dockerfile
- package.json
- prisma schema and migrations (to inspect)

## Visual/Browser Findings
- No browser/image exploration performed yet in this session.

---
*Update this file after every 2 view/browser/search operations*
