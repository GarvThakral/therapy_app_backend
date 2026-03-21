import type { LogEntry } from "@prisma/client";

import { decryptNullableUserText, decryptUserText } from "./crypto.js";
import { prisma } from "./prisma.js";

const ARCHIVE_AFTER_DAYS = 14;

export function serializeLogEntry(log: LogEntry, userKeyHex: string) {
  return {
    id: log.id,
    text: decryptUserText(log.text, userKeyHex),
    type: log.type,
    intensity: log.intensity,
    addedToPrep: log.addedToPrep,
    prepNote: decryptNullableUserText(log.prepNote, userKeyHex),
    checkedOff: log.checkedOff,
    isArchived: log.isArchived,
    archivedAt: log.archivedAt,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
  };
}

export async function archiveOldLogs(userId: string) {
  const cutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  await prisma.logEntry.updateMany({
    where: {
      userId,
      isArchived: false,
      createdAt: { lt: cutoff },
    },
    data: {
      isArchived: true,
      archivedAt: new Date(),
    },
  });
}
