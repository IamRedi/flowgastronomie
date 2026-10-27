import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// The shared edge joins two Compose projects. Their default api/web aliases are
// ambiguous there; the already verified staging container names are unique.
export function isolatedStagingTemplate(template) {
  let output = template;
  for (const [upstream, replacement] of [
    ["http://api:4000", "http://flowgastronomie-api-1:4000"],
    ["http://web:3000", "http://flowgastronomie-web-1:3000"],
  ]) {
    if (output.split(upstream).length !== 2)
      throw Error("Staging edge baseline changed; inspect before preparing");
    output = output.replace(upstream, replacement);
  }
  if (/http:\/\/(?:api|web):/.test(output))
    throw Error("Ambiguous staging upstream remains");
  return output;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination)
    throw Error("Source and new protected destination are required");
  writeFileSync(
    destination,
    isolatedStagingTemplate(readFileSync(source, "utf8")),
    { flag: "wx", mode: 0o600 },
  );
  console.log("Staging edge template prepared with unique upstreams");
}
