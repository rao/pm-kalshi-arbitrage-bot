/**
 * Intercept @polymarket/clob-client verbose error logging.
 *
 * The library logs full axios config (including auth headers, request body)
 * on every API error. This filter reformats those to a clean one-liner.
 */

const originalConsoleError = console.error;

export function installClobErrorFilter(): void {
  console.error = (...args: unknown[]) => {
    // Intercept [CLOB Client] request error messages
    if (
      args.length >= 2 &&
      typeof args[0] === "string" &&
      args[0] === "[CLOB Client] request error"
    ) {
      // args[1] is JSON.stringify({status, statusText, data, config})
      try {
        const parsed = typeof args[1] === "string" ? JSON.parse(args[1]) : args[1];
        const errorMsg = parsed?.data?.error
          || parsed?.error
          || parsed?.statusText
          || "unknown error";
        const status = parsed?.status ?? "";
        originalConsoleError(
          `[Polymarket API Error] ${errorMsg}${status ? ` (${status})` : ""}`
        );
      } catch {
        // If parsing fails, still show a clean version
        originalConsoleError(`[Polymarket API Error] ${String(args[1]).substring(0, 200)}`);
      }
      return;
    }

    // Pass everything else through unchanged
    originalConsoleError(...args);
  };
}
