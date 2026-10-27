import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { SetupImportError } from "@flowgastronomie/domain";
import { robotsAllows } from "./website-import-adapter.js";

export function businessImportLimits(env = process.env) {
  const bound = (key: string, fallback: number, max: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new Error(`Invalid ${key}`);
    return value;
  };
  return {
    requests: bound("BUSINESS_IMPORT_REQUESTS", 30, 60),
    pages: bound("BUSINESS_IMPORT_PAGES", 8, 15),
    depth: bound("BUSINESS_IMPORT_DEPTH", 2, 3),
    bytes: bound("BUSINESS_IMPORT_TOTAL_BYTES", 24_000_000, 48_000_000),
    fileBytes: bound("BUSINESS_IMPORT_FILE_BYTES", 10_000_000, 10_485_760),
    pageBytes: bound("BUSINESS_IMPORT_PAGE_BYTES", 1_000_000, 2_000_000),
    timeoutMs: bound("BUSINESS_IMPORT_TIMEOUT_MS", 60_000, 120_000),
    requestMs: bound("BUSINESS_IMPORT_REQUEST_MS", 8_000, 15_000),
    providerMs: bound("BUSINESS_IMPORT_PROVIDER_MS", 150_000, 150_000),
    userPerHour: bound("BUSINESS_IMPORT_USER_PER_HOUR", 10, 20),
    tenantPerHour: bound("BUSINESS_IMPORT_TENANT_PER_HOUR", 30, 60),
  };
}
export type DiscoveryLimits = ReturnType<typeof businessImportLimits>;
export function importUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SetupImportError("INVALID_INPUT");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    hostname.endsWith(".") ||
    (!hostname.includes(".") && !isIP(hostname)) ||
    url.href.length > 2048 ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/i.test(hostname)
  )
    throw new SetupImportError(
      "INVALID_INPUT",
      "Use a public HTTPS address without credentials or custom ports.",
    );
  if (isIP(hostname) && !publicImportAddress(hostname))
    throw new SetupImportError("INVALID_INPUT");
  url.hash = "";
  return url;
}
export function publicImportAddress(value: string) {
  try {
    const address = ipaddr.parse(value);
    // ipaddr classifies loopback, mapped IPv4, link-local, unique-local, multicast,
    // carrier NAT, reserved/documentation, transition and metadata ranges separately.
    if (address.range() !== "unicast") return false;
    if (address.kind() === "ipv6") {
      const bytes = address.toByteArray();
      // Only global 2000::/3; reject special-purpose 2001::/23 and 2002::/16.
      if (
        (bytes[0]! & 0xe0) !== 0x20 ||
        (bytes[0] === 0x20 &&
          ((bytes[1] === 1 && bytes[2]! < 2) || bytes[1] === 2))
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
export type ImportResponse = {
  status: number;
  type: string;
  location?: string | undefined;
  robots?: string | undefined;
  encoding?: string | undefined;
  bytes: Buffer;
};
export type ImportTransport = (
  url: URL,
  address: string,
  signal: AbortSignal,
  maxBytes: number,
) => Promise<ImportResponse>;
export const pinnedImportTransport: ImportTransport = (
  url,
  address,
  signal,
  maxBytes,
) =>
  new Promise((resolve, reject) => {
    const family = isIP(address) as 4 | 6;
    const req = request(
      url,
      {
        method: "GET",
        agent: false,
        family,
        signal,
        rejectUnauthorized: true,
        headers: {
          "user-agent": "FlowGastronomieImport/2.0",
          accept: "*/*",
          "accept-encoding": "identity",
        },
        // No ambient proxy, cookies, Authorization or second DNS lookup. TLS verifies url.hostname.
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options.all)
            (
              callback as unknown as (
                e: null,
                addresses: { address: string; family: number }[],
              ) => void
            )(null, [{ address, family }]);
          else callback(null, address, family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        if (Number(response.headers["content-length"] ?? 0) > maxBytes) {
          req.destroy(new SetupImportError("LIMIT"));
          return;
        }
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new SetupImportError("LIMIT"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            type: response.headers["content-type"] ?? "",
            location: response.headers.location,
            encoding: response.headers["content-encoding"],
            robots: String(response.headers["x-robots-tag"] ?? ""),
            bytes: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
export type ImportNetworkDependencies = {
  dns?: (host: string) => Promise<string[]>;
  transport?: ImportTransport;
  limits?: DiscoveryLimits;
};
export class ImportNetwork {
  readonly limits: DiscoveryLimits;
  readonly signal: AbortSignal;
  requests = 0;
  bytes = 0;
  private reservedBytes = 0;
  private robots: string | null = null;
  private readonly initial: URL;
  constructor(
    url: string,
    signal: AbortSignal,
    private dependencies: ImportNetworkDependencies = {},
  ) {
    this.initial = importUrl(url);
    this.limits = dependencies.limits ?? businessImportLimits();
    this.signal = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.limits.timeoutMs),
    ]);
  }
  private async request(url: URL, limit: number) {
    this.signal.throwIfAborted();
    importUrl(url.href);
    if (url.origin !== this.initial.origin)
      throw new SetupImportError(
        "REVIEW_REQUIRED",
        "Another website requires separate authorization.",
      );
    if (
      ++this.requests > this.limits.requests ||
      this.bytes >= this.limits.bytes
    )
      throw new SetupImportError("LIMIT");
    const reserved = Math.min(
      limit,
      this.limits.bytes - this.bytes - this.reservedBytes,
    );
    if (reserved <= 0) throw new SetupImportError("LIMIT");
    this.reservedBytes += reserved;
    let charged = false;
    try {
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const resolver = new Resolver({ timeout: 2000, tries: 1 });
      const resolve =
        this.dependencies.dns ??
        (async (host: string) => {
          const answers = await Promise.allSettled([
            resolver.resolve4(host),
            resolver.resolve6(host),
          ]);
          for (const answer of answers)
            if (
              answer.status === "rejected" &&
              !["ENODATA", "ENOTFOUND"].includes(String(answer.reason?.code))
            )
              throw new SetupImportError("UNAVAILABLE");
          return answers.flatMap((a) =>
            a.status === "fulfilled" ? a.value : [],
          );
        });
      const signal = AbortSignal.any([
        this.signal,
        AbortSignal.timeout(this.limits.requestMs),
      ]);
      const addresses = isIP(hostname)
        ? [hostname]
        : await boundedPromise(resolve(hostname), signal);
      if (!addresses.length || addresses.some((a) => !publicImportAddress(a)))
        throw new SetupImportError(
          "INVALID_INPUT",
          "The source resolves to a forbidden network.",
        );
      const response = await boundedPromise(
        (this.dependencies.transport ?? pinnedImportTransport)(
          url,
          addresses[0]!,
          signal,
          reserved,
        ),
        signal,
      );
      this.bytes += response.bytes.length;
      charged = true;
      if (response.bytes.length > limit || this.bytes > this.limits.bytes)
        throw new SetupImportError("LIMIT");
      if (response.encoding && response.encoding !== "identity")
        throw new SetupImportError(
          "INVALID_INPUT",
          "Compressed transfer is not accepted.",
        );
      if (/\b(noai|noindex|noarchive|none)\b/i.test(response.robots ?? ""))
        throw new SetupImportError(
          "REVIEW_REQUIRED",
          "This source restricts automated reuse.",
        );
      return response;
    } finally {
      this.reservedBytes -= reserved;
      // Failed or interrupted transfers consume their reservation conservatively.
      if (!charged) this.bytes += reserved;
    }
  }
  async authorize() {
    let url = new URL("/robots.txt", this.initial);
    for (let redirects = 0; redirects < 4; redirects++) {
      const response = await this.request(url, this.limits.pageBytes);
      if (
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.location
      ) {
        url = importUrl(new URL(response.location, url).href);
        continue;
      }
      if (response.status === 404 || response.status === 410) {
        this.robots = "";
        return;
      }
      if (
        response.status !== 200 ||
        !/^text\/(plain|html)(;|$)/i.test(response.type)
      )
        throw new SetupImportError(
          "REVIEW_REQUIRED",
          "Robots policy could not be verified.",
        );
      this.robots = response.bytes.toString("utf8");
      return;
    }
    throw new SetupImportError("LIMIT");
  }
  async get(value: string, limit = this.limits.pageBytes) {
    if (this.robots === null) throw new SetupImportError("REVIEW_REQUIRED");
    let url = importUrl(value);
    for (let redirects = 0; redirects < 4; redirects++) {
      if (!robotsAllows(this.robots, url.pathname + url.search))
        throw new SetupImportError(
          "REVIEW_REQUIRED",
          "Robots policy disallows this source.",
        );
      const response = await this.request(url, limit);
      if (
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.location
      ) {
        url = importUrl(new URL(response.location, url).href);
        continue;
      }
      if (response.status !== 200)
        throw new SetupImportError(
          "UNAVAILABLE",
          "This public source could not be read.",
        );
      return { ...response, url: url.href };
    }
    throw new SetupImportError("LIMIT");
  }
}
export function boundedPromise<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}
