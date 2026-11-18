FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS dependencies
WORKDIR /opt/pitcrew
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /opt/pitcrew
COPY --from=dependencies /opt/pitcrew/node_modules ./node_modules
COPY package.json package-lock.json worker.cjs matrix-worker.cjs matrix-policy.cjs function-contract.cjs function-guest.cjs function-worker.cjs function-executor.cjs primitive-codec.cjs compiled-wasm.cjs probe.cjs policy.cjs identity.cjs ./
COPY docker/init.cjs docker/job.cjs ./docker/
ENV NODE_ENV=production
# The trusted PID 1 needs SETUID/SETGID solely to launch the unprivileged job.
# The launcher drops all other capabilities and forbids new privileges.
USER 0:0
ENTRYPOINT ["/usr/local/bin/node", "--disable-sigusr1", "--max-old-space-size=16", "/opt/pitcrew/docker/init.cjs"]
CMD []
