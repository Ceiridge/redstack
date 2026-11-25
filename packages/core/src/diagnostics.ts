import type { Vec3 } from "./geometry.js";

export type Severity = "error" | "warning" | "info";

/** Machine-readable finding. Important for the AI loop: precise, with location and the parties involved. */
export interface Diagnostic {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
  readonly at?: Vec3;
  readonly instances?: readonly string[];
}

export function hasErrors(diags: readonly Diagnostic[]): boolean {
  return diags.some((d) => d.severity === "error");
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = d.at ? ` @ (${d.at.join(",")})` : "";
  return `[${d.severity}] ${d.code}${where}: ${d.message}`;
}
