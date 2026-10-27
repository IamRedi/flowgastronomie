# Compatibility packaging for the retained V3 API bundle's workspace asset lookup.
# The operator must supply a locally verified, immutable previous image reference.
ARG PREVIOUS_API_IMAGE
FROM ${PREVIOUS_API_IMAGE}
COPY --chown=node:node packages/database/package.json /app/packages/database/package.json
COPY --chown=node:node packages/database/src/index.ts /app/packages/database/src/index.ts
COPY --chown=node:node packages/database/assets/showcases /app/packages/database/assets/showcases
