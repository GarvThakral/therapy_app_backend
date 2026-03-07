import type { VercelResponse } from "@vercel/node";

function getErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
    stack: undefined,
  };
}

export function handleServerError(
  res: VercelResponse,
  context: string,
  error: unknown,
  publicMessage: string,
) {
  const details = getErrorDetails(error);
  console.error(`[${context}] ${details.message}`);
  if (details.stack) {
    console.error(details.stack);
  }

  return res.status(500).json({
    error: publicMessage,
    code: "INTERNAL_SERVER_ERROR",
  });
}
