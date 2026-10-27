import { Resolver } from "node:dns/promises";
const publicResolver = new Resolver({ timeout: 2000, tries: 1 });
import { request } from "node:https";
import { createHash } from "node:crypto";
import {
  SetupImportError,
  websiteCopyProposalSchema,
  websiteImportRequestSchema,
} from "@flowgastronomie/domain";

export function publicWebsiteUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    !url.hostname.includes(".") ||
    url.hostname.endsWith(".") ||
    url.hostname.length > 253
  )
    throw new SetupImportError(
      "INVALID_INPUT",
      "Use a public HTTPS website without credentials or custom ports.",
    );
  url.hash = "";
  return url;
}
export function isPublicIpv4(ip: string) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const [a, b, c] = ip.split(".").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  if (ip.split(".").some((x) => Number(x) > 255)) return false;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 &&
      (b === 168 ||
        (b === 0 && (c === 0 || c === 2)) ||
        (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
type Response = {
  status: number;
  location?: string | undefined;
  type: string;
  body: string;
};
type Transport = (url: URL, pinnedAddress: string) => Promise<Response>;
const boundedHttps: Transport = (url, pinnedAddress) =>
  new Promise((resolve, reject) => {
    // DNS is pinned for this request, while TLS still verifies the original hostname.
    const req = request(
      url,
      {
        method: "GET",
        family: 4,
        headers: {
          "user-agent": "FlowGastronomieImport/1.0",
          accept: "text/html,text/plain;q=0.9",
          "accept-encoding": "identity",
        },
        lookup: (_host, _options, callback) => callback(null, pinnedAddress, 4),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1_000_000) {
            req.destroy(new Error("limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            type: res.headers["content-type"] ?? "",
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );
    const deadline = setTimeout(() => req.destroy(new Error("timeout")), 5000);
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    req.end();
  });
function text(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:amp|quot|apos|lt|gt|nbsp);/g,
      (e) =>
        ({
          "&amp;": "&",
          "&quot;": '"',
          "&apos;": "'",
          "&lt;": "<",
          "&gt;": ">",
          "&nbsp;": " ",
        })[e]!,
    )
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function extractWebsiteCopy(html: string) {
  if (/\b(?:noai|noindex|noarchive)\b/i.test(html.slice(0, 100000)))
    throw new SetupImportError(
      "REVIEW_REQUIRED",
      "This website declares a restriction on automated reuse.",
    );
  const title = text(
    /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "",
  ).slice(0, 120);
  let description = "";
  for (const tag of html.match(/<meta\b[^>]{0,5000}>/gi) ?? []) {
    if (/\bname\s*=\s*["']description["']/i.test(tag))
      description = text(
        /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i
          .exec(tag)
          ?.slice(1)
          .find(Boolean) ?? "",
      ).slice(0, 280);
  }
  return { title, description };
}
export function robotsAllows(body: string, path: string) {
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };
  const groups: Group[] = [];
  let current: Group = { agents: [], rules: [] };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.split("#")[0]!.trim();
    const split = line.indexOf(":");
    if (split < 0) continue;
    const field = line.slice(0, split).trim().toLowerCase(),
      value = line.slice(split + 1).trim();
    if (field === "user-agent") {
      if (current.rules.length) {
        groups.push(current);
        current = { agents: [], rules: [] };
      }
      current.agents.push(value.toLowerCase());
    } else if (["allow", "disallow"].includes(field) && current.agents.length)
      current.rules.push({ allow: field === "allow", path: value });
  }
  groups.push(current);
  const agent = "flowgastronomieimport";
  const specific = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && a && agent.includes(a)),
  );
  const selected = specific.length
    ? specific
    : groups.filter((g) => g.agents.includes("*"));
  const rules = selected.flatMap((g) => g.rules).filter((r) => r.path);
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  // Conservatively compare decoded paths too, rather than letting encoded links
  // reach disallowed server routes. Wildcard disallows take priority over guesses.
  for (const candidate of new Set([path, decode(path), decode(decode(path))])) {
    const matches = rules.filter((r) =>
      candidate.startsWith(decode(r.path).split(/[*$]/)[0]!),
    );
    if (matches.some((r) => !r.allow && /[*$]/.test(r.path))) return false;
    matches.sort(
      (a, b) =>
        b.path.length - a.path.length || Number(b.allow) - Number(a.allow),
    );
    if (matches[0] && !matches[0].allow) return false;
  }
  return true;
}
export async function proposeWebsiteCopy(
  value: unknown,
  dependencies: {
    dns?: (hostname: string) => Promise<string[]>;
    transport?: Transport;
  } = {},
) {
  const input = websiteImportRequestSchema.parse(value);
  const initial = publicWebsiteUrl(input.url);
  const dns =
      dependencies.dns ?? ((host: string) => publicResolver.resolve4(host)),
    transport = dependencies.transport ?? boundedHttps;
  let requests = 0;
  const get = async (url: URL): Promise<Response> => {
    if (++requests > 5) throw new SetupImportError("LIMIT");
    publicWebsiteUrl(url.href);
    if (url.origin !== initial.origin)
      throw new SetupImportError(
        "REVIEW_REQUIRED",
        "Redirects to another website require a separate authorization.",
      );
    const addresses = await dns(url.hostname);
    if (!addresses.length || addresses.some((ip) => !isPublicIpv4(ip)))
      throw new SetupImportError(
        "INVALID_INPUT",
        "Only publicly reachable IPv4 websites are supported.",
      );
    const response = await transport(url, addresses[0]!);
    if (response.body.length > 1_000_000) throw new SetupImportError("LIMIT");
    return response;
  };
  try {
    const robots = await get(new URL("/robots.txt", initial));
    if (
      robots.status !== 404 &&
      (robots.status !== 200 || !robotsAllows(robots.body, initial.pathname))
    )
      throw new SetupImportError(
        "REVIEW_REQUIRED",
        "The website's robots policy does not permit this import.",
      );
    let url = initial;
    for (let redirect = 0; redirect <= 3; redirect++) {
      if (robots.status === 200 && !robotsAllows(robots.body, url.pathname))
        throw new SetupImportError("REVIEW_REQUIRED");
      const response = await get(url);
      if (
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.location
      ) {
        url = publicWebsiteUrl(new URL(response.location, url).href);
        continue;
      }
      if (response.status !== 200 || !/^text\/html(?:;|$)/i.test(response.type))
        throw new SetupImportError(
          "INVALID_INPUT",
          "Only a public HTML page can be imported.",
        );
      return websiteCopyProposalSchema.parse({
        sourceUrl: url.href,
        ...extractWebsiteCopy(response.body),
        fetchedAt: new Date().toISOString(),
        contentHash: createHash("sha256").update(response.body).digest("hex"),
        confidence: "UNVERIFIED",
      });
    }
    throw new SetupImportError("LIMIT");
  } catch (error) {
    if (error instanceof SetupImportError) throw error;
    throw new SetupImportError(
      "UNAVAILABLE",
      "The website could not be read safely. You can still enter your text manually.",
    );
  }
}
