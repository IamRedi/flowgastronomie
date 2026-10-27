import { createHash } from "node:crypto";
import { SetupImportError, type PlatformLocale } from "@flowgastronomie/domain";
import {
  menuImportRepository,
  type SetupStaff,
} from "@flowgastronomie/database";
import {
  menuExtractionConfigured,
  menuExtractionInstructions,
  OpenAIMenuExtractionProvider,
  type MenuExtractionProvider,
} from "./menu-extraction-provider.js";
export async function extractMenuImport(
  staff: SetupStaff,
  id: string,
  input: { expectedVersion: number; requestKey: string },
  provider?: MenuExtractionProvider,
) {
  if (!provider) {
    if (!menuExtractionConfigured())
      throw new SetupImportError(
        "UNAVAILABLE",
        "Menu extraction is not configured. You can skip import and use the menu editor.",
      );
    provider = new OpenAIMenuExtractionProvider();
  }
  const claim = await menuImportRepository.beginExtraction(
    staff,
    id,
    input.expectedVersion,
    input.requestKey,
    provider.provider,
    provider.model,
  );
  if (!claim.claimed) return menuImportRepository.get(staff, id);
  const started = Date.now();
  let provenance: Record<string, unknown> = {
    provider: provider.provider,
    model: provider.model,
    requestKey: input.requestKey,
    promptHash: createHash("sha256")
      .update(menuExtractionInstructions)
      .digest("hex"),
    sourceHashes: claim.session.sources.map((s) => ({
      id: s.id,
      hash: s.contentHash,
    })),
    automaticRetries: 0,
  };
  try {
    const sources = await Promise.all(
      claim.session.sources.map(async (source) => ({
        ...source,
        bytes: (await menuImportRepository.source(staff, id, source.id)).bytes,
      })),
    );
    const result = await provider.extract({
      locale: claim.session.locale.toLowerCase() as PlatformLocale,
      sources,
      requestKey: input.requestKey,
    });
    provenance = {
      ...provenance,
      providerRequestId: result.requestId,
      usage: result.usage,
      latencyMs: Date.now() - started,
      extractedAt: new Date().toISOString(),
    };
    await menuImportRepository.finishExtraction(staff, id, input.requestKey, {
      proposal: result.proposal,
      provenance,
    });
  } catch (error) {
    await menuImportRepository.finishExtraction(staff, id, input.requestKey, {
      errorCode:
        error instanceof SetupImportError ? error.code : "INVALID_EXTRACTION",
      provenance: { ...provenance, latencyMs: Date.now() - started },
    });
    throw new SetupImportError(
      "UNAVAILABLE",
      "Extraction could not produce a valid proposal. Your menu is unchanged. Review the source before explicitly retrying.",
    );
  }
  return menuImportRepository.get(staff, id);
}
