import crypto from "node:crypto";
import path from "node:path";
import { mkdir, stat, writeFile } from "node:fs/promises";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "../logger.js";
import type { RawAttachment } from "../tpo/schemas.js";
import type { PlacementAIService } from "../ai/placement-ai-service.js";
import { extractPdfText, looksLikePdf } from "./pdf-text.js";

/**
 * Attachment handling (M8): metadata-first persistence of placement PDFs.
 *
 * - `fileUrl` values are pre-signed S3 URLs that expire (~24h) — they are
 *   NEVER persisted. Stable identity is the TPO attachment id; `filepath`
 *   (the object key) is kept for reference.
 * - A document is downloaded at most once per metadata observation: local
 *   presence short-circuits re-download; a missing local file triggers
 *   re-download on the next metadata observation (fresh signed URL).
 * - Extraction failures never lose the metadata row — the file stays
 *   stored and re-extractable later.
 * - Download failures leave a metadata-only row so the gap is visible.
 */

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export type FetchFn = typeof globalThis.fetch;

function sha256HexBytes(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function fileExists(p: string | null | undefined): Promise<boolean> {
  if (!p) return false;
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Only the base name survives — documents live under our own layout. */
function sanitizeFilename(filename: string): string {
  const base = path
    .basename(filename)
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .trim();
  return base.length > 0 ? base : "attachment";
}

interface StoredFields {
  localPath?: string;
  contentHash?: string;
  extractedText?: string;
  downloadedAt?: Date;
  aiExtraction?: Prisma.InputJsonValue;
  aiModel?: string;
  aiExtractedAt?: Date;
}

export class AttachmentService {
  constructor(
    private readonly db: PrismaClient,
    private readonly log: Logger,
    private readonly fetchFn: FetchFn = globalThis.fetch,
    private readonly rootDir: string = path.join("var", "attachments"),
    private readonly ai?: PlacementAIService,
  ) {}

  async syncFor(
    opportunityId: number,
    externalId: string,
    raw: RawAttachment[],
  ): Promise<void> {
    for (const att of raw) {
      try {
        await this.syncOne(opportunityId, att);
      } catch (err) {
        // One broken attachment never blocks the rest.
        this.log.warn(
          { externalId, attachmentId: att.id, err: String(err) },
          "attachment sync failed (continuing)",
        );
      }
    }
  }

  private async syncOne(
    opportunityId: number,
    att: RawAttachment,
  ): Promise<void> {
    const externalId = String(att.id);
    const existing = await this.db.placementAttachment.findUnique({
      where: { opportunityId_externalId: { opportunityId, externalId } },
    });

    if (existing?.downloadedAt && (await fileExists(existing.localPath))) {
      this.log.debug({ attachmentId: att.id }, "attachment already stored");
      return;
    }

    const fileUrl = att.fileUrl ?? undefined;
    if (!fileUrl) {
      await this.upsertMetadata(opportunityId, externalId, att);
      this.log.warn(
        { attachmentId: att.id },
        "attachment has no file URL; storing metadata only",
      );
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = await this.download(fileUrl, att.id);
    } catch (err) {
      await this.upsertMetadata(opportunityId, externalId, att);
      this.log.warn(
        { attachmentId: att.id, err: String(err) },
        "download failed; storing metadata only",
      );
      return;
    }

    const localPath = this.localPathFor(opportunityId, att.id, att.filename);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, bytes, { mode: 0o644 });

    const stored: StoredFields = {
      localPath,
      contentHash: sha256HexBytes(bytes),
      downloadedAt: new Date(),
    };

    if (looksLikePdf(bytes)) {
      try {
        const { text } = await extractPdfText(bytes);
        if (text.length > 0) {
          stored.extractedText = text;
          const aiFields = await this.runAiExtraction(text, att.id);
          if (aiFields) {
            stored.aiExtraction = aiFields.aiExtraction;
            stored.aiModel = aiFields.aiModel;
            stored.aiExtractedAt = aiFields.aiExtractedAt;
          }
        } else {
          this.log.warn(
            { attachmentId: att.id },
            "PDF extracted to empty text (likely scanned images)",
          );
        }
      } catch (err) {
        this.log.warn(
          { attachmentId: att.id, err: String(err) },
          "PDF extraction failed; file stored without text",
        );
      }
    } else {
      this.log.warn(
        { attachmentId: att.id },
        "attachment is not a PDF; stored without text extraction",
      );
    }

    await this.db.placementAttachment.upsert({
      where: { opportunityId_externalId: { opportunityId, externalId } },
      create: {
        opportunityId,
        externalId,
        filename: att.filename,
        objectKey: att.filepath ?? undefined,
        ...stored,
      } as Prisma.PlacementAttachmentUncheckedCreateInput,
      update: {
        filename: att.filename,
        objectKey: att.filepath ?? undefined,
        ...stored,
      } as Prisma.PlacementAttachmentUncheckedUpdateInput,
    });
    this.log.info(
      { attachmentId: att.id, filename: att.filename, bytes: bytes.length },
      "📄 attachment stored",
    );
  }

  /**
   * AI structured extraction of the document text (M9). Best-effort:
   * any failure is logged and the document row is still stored.
   */
  private async runAiExtraction(
    text: string,
    attachmentId: number,
  ): Promise<
    | {
        aiExtraction: Prisma.InputJsonValue;
        aiModel: string;
        aiExtractedAt: Date;
      }
    | undefined
  > {
    if (!this.ai) return undefined;
    try {
      const extraction = await this.ai.extract(text);
      if (!extraction) return undefined; // disabled / too short / invalid output
      this.log.info(
        { attachmentId, confidence: extraction.confidence },
        "🤖 AI extraction stored",
      );
      return {
        aiExtraction: extraction as unknown as Prisma.InputJsonValue,
        aiModel: this.ai.modelName,
        aiExtractedAt: new Date(),
      };
    } catch (err) {
      this.log.warn(
        { attachmentId, err: String(err) },
        "AI extraction failed; continuing without it",
      );
      return undefined;
    }
  }

  /** Download with a hard size cap. Throws on failure/oversize. */
  private async download(
    fileUrl: string,
    _attachmentId: number,
  ): Promise<Uint8Array> {
    const response = await this.fetchFn(fileUrl);
    if (!response.ok) {
      throw new Error(`download failed with HTTP ${response.status}`);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `download exceeds size cap (${buffer.byteLength} > ${MAX_DOWNLOAD_BYTES} bytes)`,
      );
    }
    return buffer;
  }

  private async upsertMetadata(
    opportunityId: number,
    externalId: string,
    att: RawAttachment,
  ): Promise<void> {
    await this.db.placementAttachment.upsert({
      where: { opportunityId_externalId: { opportunityId, externalId } },
      create: {
        opportunityId,
        externalId,
        filename: att.filename,
        objectKey: att.filepath ?? undefined,
      } as Prisma.PlacementAttachmentUncheckedCreateInput,
      update: {
        filename: att.filename,
        objectKey: att.filepath ?? undefined,
      } as Prisma.PlacementAttachmentUncheckedUpdateInput,
    });
  }

  private localPathFor(
    opportunityId: number,
    attachmentId: number,
    filename: string,
  ): string {
    return path.join(
      this.rootDir,
      String(opportunityId),
      `${attachmentId}-${sanitizeFilename(filename)}`,
    );
  }
}
