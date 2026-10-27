import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { CreativeError } from "@flowgastronomie/domain";
import { prisma } from "@flowgastronomie/database";

export interface CreativeAssetStorage {
  put(bytes: Buffer): Promise<string>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
// Files are served only by authenticated, scoped asset/export routes. No public
// directory, arbitrary URL fetching, or user-controlled filesystem paths.
export class FileCreativeStorage implements CreativeAssetStorage {
  constructor(
    private root = process.env.CREATIVE_STORAGE_DIR ??
      path.resolve(".creative-assets"),
  ) {}
  private location(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new CreativeError("NOT_FOUND");
    return path.join(this.root, key);
  }
  async put(bytes: Buffer) {
    const key = createHash("sha256").update(bytes).digest("hex");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    try {
      await writeFile(this.location(key), bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return key;
  }
  async read(key: string) {
    if (key.startsWith("canonical:")) {
      const match = /^canonical:([a-zA-Z0-9_-]+):([a-f0-9]{64})$/.exec(key);
      if (!match) throw new CreativeError("NOT_FOUND");
      const asset = await prisma.mediaAsset.findFirst({
        where: { id: match[1]!, contentHash: match[2]! },
      });
      if (!asset) throw new CreativeError("NOT_FOUND");
      return Buffer.from(asset.bytes);
    }
    return readFile(this.location(key));
  }
  async delete(key: string) {
    await unlink(this.location(key));
  }
}
export const creativeStorage = new FileCreativeStorage();
