import { request as httpRequest } from "node:http";

/** Observe an actual early HTTP response without racing a rejected body writer. */
export function oversizedUploadStatus(url, cookie, timeoutMs = 15000) {
  const target = new URL(url);
  if (
    target.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 15000
  ) {
    return Promise.reject(new Error("Bounded loopback upload probe required"));
  }
  return new Promise((resolve, reject) => {
    let response;
    let settled = false;
    function finish(error, status) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      response?.destroy();
      request.destroy();
      if (error) reject(error);
      else resolve(status);
    }
    const request = httpRequest(
      target,
      {
        method: "PUT",
        headers: {
          "Content-Type": "image/png",
          "Content-Length": 5 * 1024 * 1024 + 1,
          Cookie: cookie,
          Connection: "close",
        },
      },
      (incoming) => {
        response = incoming;
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 64 * 1024)
            finish(new Error("Upload probe response exceeded bound"));
        });
        response.once("end", () => finish(null, response.statusCode ?? 0));
        response.once("aborted", () =>
          finish(new Error("Upload probe response aborted")),
        );
        response.once("error", (error) => finish(error));
      },
    );
    const deadline = setTimeout(
      () => finish(new Error("Upload probe timeout")),
      timeoutMs,
    );
    request.once("error", (error) => finish(error));
    // Fastify rejects the declared size before consuming a body. Sending only
    // headers avoids EPIPE from a multi-megabyte write after that rejection.
    // A server that waits for the body fails the bounded timeout, never PASS.
    request.end();
  });
}
