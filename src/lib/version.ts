/**
 * Single source for UI version fallbacks. The backend reports the real
 * version via `get_diagnostics`; this mirrors package.json so the fallback
 * and the mock harness can never drift from the release version.
 */
import pkg from "../../package.json";

export const APP_VERSION: string = pkg.version;
