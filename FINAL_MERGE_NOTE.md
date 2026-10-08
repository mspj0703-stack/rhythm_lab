# BEATDASH v4.0 RC Hotfix — Final Reviewed Merge

Merged: 2026-09-30

Base: BEATDASH-v4.0-RC-hotfix-source.zip
Applied: BEATDASH-v4.0-RC-hotfix-review-fix.patch

Result revision: v4-rc-hotfix-reviewed

This tree includes the independent review fixes. See HOTFIX_INDEPENDENT_REVIEW.md for the authoritative review result and device-verification hold status.

This merge step verified:
- `git apply --check` succeeded before applying the review patch.
- Review patch applied without rejects.
- Expected reviewed files exist, including `web/src/engine/mediaRecovery.ts` and the expanded hotfix tests.
- Python source compile check passed.

The merge step did not independently re-certify Android APK/signing or physical-device behavior. v4.0 remains RC until the physical Android checklist is completed.
