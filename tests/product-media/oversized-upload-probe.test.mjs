import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { oversizedUploadStatus } from "./oversized-upload-probe.mjs";

async function withServer(handler, use) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await use(`http://127.0.0.1:${server.address().port}/upload`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("observes early 413 with oversized declaration and no body writer", async () => {
  let bytes = 0;
  await withServer(
    (request, response) => {
      assert.equal(request.method, "PUT");
      assert.equal(
        Number(request.headers["content-length"]),
        5 * 1024 * 1024 + 1,
      );
      assert.equal(request.headers.cookie, "synthetic=only");
      request.on("data", (chunk) => (bytes += chunk.length));
      response.writeHead(413, { Connection: "close" }).end("too large");
    },
    async (url) => {
      for (let i = 0; i < 20; i++) {
        assert.equal(await oversizedUploadStatus(url, "synthetic=only"), 413);
      }
    },
  );
  assert.equal(bytes, 0);
});

test("a transport reset is never converted to an HTTP rejection", async () => {
  await withServer(
    (request) => request.socket.destroy(),
    (url) =>
      assert.rejects(oversizedUploadStatus(url, ""), /socket hang up|reset/i),
  );
});

test("preserves an unexpected HTTP response for the caller's strict assertion", async () => {
  await withServer(
    (_request, response) => response.writeHead(200).end(),
    async (url) => assert.equal(await oversizedUploadStatus(url, ""), 200),
  );
});

test("a server waiting for a body fails within the configured bound", async () => {
  await withServer(
    () => {},
    (url) =>
      assert.rejects(oversizedUploadStatus(url, "", 50), /probe timeout/),
  );
});

test("refuses non-loopback targets", async () => {
  await assert.rejects(
    oversizedUploadStatus("https://example.com/upload", ""),
    /Bounded loopback/,
  );
});

test("413 headers followed by a stalled body still fail and close the socket", async () => {
  let closed;
  await withServer(
    (request, response) => {
      closed = new Promise((resolve) => request.socket.once("close", resolve));
      response.writeHead(413, { "Content-Length": 20 });
      response.flushHeaders();
    },
    async (url) => {
      await assert.rejects(
        oversizedUploadStatus(url, "", 100),
        /probe timeout/,
      );
      await closed;
    },
  );
});

test("413 with a truncated body is not a completed response", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(413, { "Content-Length": 20 });
      response.write("partial");
      setImmediate(() => response.socket?.end());
    },
    (url) => assert.rejects(oversizedUploadStatus(url, ""), /aborted|reset/i),
  );
});
