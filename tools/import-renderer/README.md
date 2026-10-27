# Isolated import renderer

Optional, prebuilt Docker worker for the Smart Business Import V2 network broker.
The API accepts only an immutable image digest and runs it without network,
credentials, mounts or outer capabilities. Chromium's own sandbox is enabled.
See [operator configuration](../../docs/architecture/SMART_BUSINESS_IMPORT_V2.md).

`seccomp_profile.json` derives from the
[Playwright v1.62.1 profile](https://github.com/microsoft/playwright/blob/v1.62.1/utils/docker/seccomp_profile.json),
licensed under Apache 2.0 (included in `LICENSE`). The change removes the
outer-capability conditional on `chroot`, permitting Chromium's user-namespace
sandbox to restrict itself while Docker still drops all outer capabilities.
No privileged mode, host network or sandbox-disabling browser flag is used.
