FROM denoland/deno:debian-2.9.1 AS builder

WORKDIR /app
COPY deno.json deno.lock* ./
COPY client ./client
COPY server ./server
COPY scripts ./scripts
RUN deno task build

FROM denoland/deno:debian-2.9.1 AS runtime

WORKDIR /app
COPY --from=builder --chown=deno:deno /app/dist ./dist
USER deno
EXPOSE 8000
CMD ["run", "--allow-net", "--allow-read=dist/client,dist/data", "--allow-env", "--allow-sys=osRelease", "dist/docker.js"]
