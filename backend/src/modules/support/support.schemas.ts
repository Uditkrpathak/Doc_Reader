import { z } from 'zod';

// Regex detecting path-like strings (e.g. /storage/..., C:\..., /sdcard/...)
const PATH_REGEX = /(\/|[a-zA-Z]:\\)([\w\-. ]+[\/\\])+[\w\-. ]+/g;

export function stripPathText(text?: string): string | undefined {
  if (!text) return text;
  return text.replace(PATH_REGEX, '[REDACTED_PATH]');
}

export const adReportSchema = z
  .object({
    placement: z.string().min(1).max(64),
    reasons: z.array(z.string().min(1).max(64)).min(1),
    details: z.string().max(500).optional().transform(stripPathText),
    adSource: z.string().min(1).max(64),
    campaignId: z.string().uuid().optional(),
    adResponseId: z.string().max(128).optional(),
    // Explicitly reject location fields
    latitude: z.never().optional(),
    longitude: z.never().optional(),
    lat: z.never().optional(),
    lng: z.never().optional(),
  })
  .strict();

export const problemReportSchema = z
  .object({
    problemType: z.string().min(1).max(64),
    details: z.string().max(1000).optional().transform(stripPathText),
    fileExtension: z.string().min(1).max(16),
    detectedType: z.string().min(1).max(64),
    sizeBucket: z.string().min(1).max(32), // e.g. "< 5MB", "5-25MB"
    errorCode: z.string().max(64).optional(),
    engine: z.string().min(1).max(64), // e.g. "PDFium", "SheetJS"
    appVersion: z.string().min(1).max(32),
    osVersion: z.string().min(1).max(32),
    deviceModel: z.string().min(1).max(64),
    // Strictly rejects any other field! (e.g. fileName, filePath, content)
  })
  .strict();

export const supportTicketSchema = z
  .object({
    category: z.string().min(1).max(64),
    email: z.string().email().max(255),
    message: z.string().min(1).max(2000),
  })
  .strict();

