import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { SetupImportError } from "@flowgastronomie/domain";
import type { IsolatedWebsiteRenderer } from "./business-import-discovery.js";

export function configuredBusinessRenderer(
  env = process.env,
): IsolatedWebsiteRenderer | undefined {
  const image = env.BUSINESS_IMPORT_RENDERER_IMAGE;
  if (!image) return undefined;
  if (!/^(?:[a-z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/.test(image))
    throw new Error(
      "Pin BUSINESS_IMPORT_RENDERER_IMAGE to a prebuilt image digest.",
    );
  return async (url, html, network, outerSignal) => {
    const name = `flow-import-${randomUUID()}`;
    const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(20_000)]);
    // No host mounts, sockets, credentials or ambient server environment enter the
    // renderer. Network syscalls have no egress. Only bounded parent GETs are served.
    const seccomp = fileURLToPath(
      new URL(
        "../../../tools/import-renderer/seccomp_profile.json",
        import.meta.url,
      ),
    );
    const child = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--pull=never",
        "-i",
        "--name",
        name,
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        `--security-opt=seccomp=${seccomp}`,
        "--pids-limit=256",
        "--memory=768m",
        "--cpus=1",
        "--tmpfs=/tmp:rw,nosuid,size=256m",
        "--user=pwuser",
        image,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    const lines = createInterface({ input: child.stdout });
    let outputBytes = 0;
    const stop = () => {
      child.stdin.destroy();
      child.kill();
      const cleanup = spawn("docker", ["rm", "-f", name], {
        windowsHide: true,
        stdio: "ignore",
      });
      cleanup.on("error", () => {});
    };
    const send = (data: unknown) => {
      if (!child.stdin.destroyed)
        child.stdin.write(JSON.stringify(data) + "\n");
    };
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error, bytes?: Buffer) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", abort);
          error ? reject(error) : resolve(bytes!);
        };
        const abort = () =>
          finish(
            new SetupImportError(
              "UNAVAILABLE",
              "Isolated rendering timed out or was cancelled.",
            ),
          );
        signal.addEventListener("abort", abort, { once: true });
        child.on("error", () => finish(new SetupImportError("UNAVAILABLE")));
        child.stdin.on("error", () =>
          finish(new SetupImportError("UNAVAILABLE")),
        );
        child.on("exit", () => finish(new SetupImportError("UNAVAILABLE")));
        child.stderr.on("data", () => {});
        child.stdout.on("data", (chunk: Buffer) => {
          outputBytes += chunk.length;
          if (outputBytes > 4_000_000) {
            finish(new SetupImportError("LIMIT"));
            stop();
          }
        });
        lines.on("line", (line: string) => {
          let message: {
            type?: string;
            id?: number;
            url?: string;
            method?: string;
            html?: string;
          };
          try {
            message = JSON.parse(line);
          } catch {
            finish(new SetupImportError("INVALID_INPUT"));
            return;
          }
          if (message.type === "resource" && typeof message.id === "number") {
            const id = message.id;
            if (message.method !== "GET" || !message.url) {
              send({ id, denied: true });
              return;
            }
            void network
              .get(message.url)
              .then((response) => {
                if (
                  !/^(?:text\/(?:html|css|plain|javascript)|application\/(?:javascript|json))(?:;|$)/i.test(
                    response.type,
                  )
                ) {
                  send({ id, denied: true });
                  return;
                }
                send({
                  id,
                  type: response.type,
                  bytes: response.bytes.toString("base64"),
                });
              })
              .catch(() => send({ id, denied: true }));
          } else if (
            message.type === "complete" &&
            typeof message.html === "string"
          ) {
            const bytes = Buffer.from(message.html, "utf8");
            if (bytes.length > network.limits.pageBytes)
              finish(new SetupImportError("LIMIT"));
            else finish(undefined, bytes);
          } else finish(new SetupImportError("INVALID_INPUT"));
        });
        if (signal.aborted) abort();
        else send({ url, html: html.toString("base64") });
      });
    } finally {
      lines.close();
      stop();
    }
  };
}
