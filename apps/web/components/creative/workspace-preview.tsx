"use client";
import { useEffect, useState } from "react";
import { creativeApi } from "./api";

export function WorkspacePreview({
  projectId,
  version,
  alt,
}: {
  projectId: string;
  version: number;
  alt: string;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setFailed(false);
    setUrl("");
    void fetch(`${creativeApi}/projects/${projectId}/preview?v=${version}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Preview unavailable");
        const blob = await response.blob();
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, version]);
  return (
    <div className="cw-preview">
      {url ? (
        <img src={url} alt={alt} />
      ) : (
        <p role="status">
          {failed
            ? "Preview unavailable · check source and image approval"
            : "…"}
        </p>
      )}
    </div>
  );
}
