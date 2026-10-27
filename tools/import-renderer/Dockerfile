FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /opt/flow-renderer
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund playwright-core@1.62.1
COPY worker.mjs ./worker.mjs
USER pwuser
ENTRYPOINT ["node", "/opt/flow-renderer/worker.mjs"]
