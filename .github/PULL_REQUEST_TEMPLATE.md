## Summary

Brief description of changes.

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behaviour)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)

## Module(s) Affected

- [ ] Auth
- [ ] Email
- [ ] Calendar
- [ ] Contacts
- [ ] Categories
- [ ] Settings
- [ ] Folder
- [ ] Rules
- [ ] Advanced
- [ ] Utils / Config
- [ ] Plugin (skill, safety hook or manifests)
- [ ] Documentation

## Checklist

- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Formatting passes (`npm run format:check`)
- [ ] Documentation updated if needed
- [ ] `docs/quickrefs/tools-reference.md` updated (if tools changed)
- [ ] New tools and actions classified in `utils/risk-classes.js`, then `node scripts/sync-risk-map.js` run (if tools changed)
- [ ] Plugin validates (`claude plugin validate --strict plugins/outlook-assistant`)
- [ ] Follows code style guidelines

## Related Issues

Fixes #

## Test Plan

How was this tested?

## Additional Notes

Any additional context for reviewers.
