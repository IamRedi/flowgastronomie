export const creativeApi =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(
    /\/$/,
    "",
  ) + "/v1/staff/creative";
export async function studioRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const headers = new Headers(options?.headers);
  if (typeof options?.body === "string")
    headers.set("Content-Type", "application/json");
  const response = await fetch(creativeApi + path, {
    ...options,
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.message ?? error.code ?? "Unable to complete this action.",
    );
  }
  return response.json() as Promise<T>;
}

// Keep cross-origin attachment downloads in the current workspace.
export async function downloadCreativeFile(id: string, type: string) {
  const response = await fetch(
    `${creativeApi}/exports/${encodeURIComponent(id)}/content`,
    { credentials: "include" },
  );
  if (!response.ok)
    throw new Error(
      "The saved file could not be downloaded. Try again from the archive.",
    );
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `design-${id}.${type.toLowerCase()}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
