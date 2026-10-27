import { LAB_MARKER } from "./guard.js";
import { request as httpRequest } from "node:http";
import { labActionContext } from "./action-context.js";
export const API = "http://127.0.0.1:4400";
export class LabHttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    path: string,
  ) {
    super(
      `${status} ${code} ${path.startsWith("/v1/public/") ? "[public lab route]" : path}`,
    );
  }
}
export class LabClient {
  cookie = "";
  constructor(private profile?: "DE" | "AL") {}
  async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new Error("LAB_PATH_FORBIDDEN");
    const response = await new Promise<{
      status: number;
      text: string;
      cookie?: string;
    }>((resolve, reject) => {
      const req = httpRequest(
        API + path,
        {
          method,
          timeout: 30000,
          localAddress:
            this.profile === "DE"
              ? "127.0.0.2"
              : this.profile === "AL"
                ? "127.0.0.3"
                : "127.0.0.1",
          headers: {
            ...(labActionContext.getStore()
              ? {
                  "x-operations-lab-action":
                    labActionContext.getStore()!.eventId,
                }
              : {}),
            ...(this.cookie ? { cookie: this.cookie } : {}),
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let length = 0;
          res.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > 2000000)
              req.destroy(new Error("LAB_RESPONSE_TOO_LARGE"));
            else chunks.push(chunk);
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 500,
              text: Buffer.concat(chunks).toString("utf8"),
              ...(res.headers["set-cookie"]?.[0]
                ? { cookie: res.headers["set-cookie"][0] }
                : {}),
            }),
          );
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("LAB_HTTP_TIMEOUT")));
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    const text = response.text;
    const value = text ? JSON.parse(text) : null;
    if (response.status < 200 || response.status >= 300)
      throw new LabHttpError(
        response.status,
        value?.code ?? "HTTP_FAILURE",
        path,
      );
    const cookie = response.cookie;
    if (cookie?.startsWith("flowgastronomie_staff_session="))
      this.cookie = cookie.split(";")[0]!;
    return value as T;
  }
}
export async function assertLabApi() {
  const identity = await new LabClient().request("GET", "/lab/identity");
  if (identity.marker !== LAB_MARKER) throw new Error("LAB_API_FORBIDDEN");
}
