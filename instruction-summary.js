/**
 * Injection summary for the settings page and diagnostics.
 *
 * Records what actually reached the prompt for one assembly: which workspace
 * files were injected, how many bytes each took, which were skipped (switched
 * off or out of budget) and which candidates were absent. File bodies are never
 * kept here — only names, byte counts, section slots and reasons — so the
 * report is safe to render in the settings page and to write to diagnostics.
 * @module dsh-instruction-files/instruction-summary
 */

/** Newest report per workspace; bounded so long runs cannot grow it without limit. */
const MAX_ENTRIES = 8;
const reports = new Map();

/**
 * Pure summary builder: one assembly's outcomes in, one report out.
 * @param {object} input - Assembly outcomes.
 * @returns {object} Report with injected files, skips, missing candidates and totals.
 */
export function summarizeInstructionFiles({
  at = Date.now(), cwd = '', preset = '', enabled = false, budget = 0,
  injected = [], skipped = [], missing = [], optionalMissing = [], identity, projectBytes = 0,
} = {}) {
  const files = injected.map(({ name, bytes = 0, section = '' }) => ({ name: String(name), bytes: Number(bytes) || 0, section: String(section) }));
  const used = files.reduce((total, file) => total + file.bytes, 0);
  const dropped = skipped.map(({ name, bytes = 0, reason = '' }) => ({ name: String(name), bytes: Number(bytes) || 0, reason: String(reason) }));
  return Object.freeze({
    at, cwd: String(cwd), preset: String(preset), enabled: Boolean(enabled),
    budget: Number(budget) || 0, used, remaining: Math.max(0, (Number(budget) || 0) - used), projectBytes: Number(projectBytes) || 0,
    files, skipped: dropped, missing: missing.map(String), optionalMissing: optionalMissing.map(String),
    identity: identity ? Object.freeze({
      name: String(identity.name ?? 'identity.md'), bytes: Number(identity.bytes) || 0,
      injected: Boolean(identity.injected), reason: String(identity.reason ?? ''),
    }) : null,
  });
}

/**
 * Remember a workspace's newest report; the oldest workspace is evicted first.
 * @param {object} report - Report from {@link summarizeInstructionFiles}.
 * @returns {object} The stored report.
 */
export function publishInstructionSummary(report) {
  if (!report?.cwd) return report;
  reports.delete(report.cwd);
  reports.set(report.cwd, report);
  while (reports.size > MAX_ENTRIES) reports.delete(reports.keys().next().value);
  return report;
}

/** Reports for the settings page, newest assembly first. */
export function instructionSummaryReport() {
  return [...reports.values()].sort((a, b) => b.at - a.at);
}

/** Stable signature so identical assemblies do not repeat a diagnostics event. */
export function summarySignature(report) {
  if (!report) return '';
  return JSON.stringify([
    report.enabled, report.budget, report.used, report.projectBytes,
    report.files.map(file => [file.name, file.bytes, file.section]),
    report.skipped.map(file => [file.name, file.bytes, file.reason]),
    report.missing,
    report.optionalMissing,
    report.identity,
  ]);
}

/**
 * Diagnostics payload for one report. The diagnostics writer keeps a fixed
 * metadata allowlist (numeric count/sizeBytes, a short code, a known state) and
 * drops everything else on purpose, so the event carries only that subset while
 * the full detail stays on the settings page.
 * @param {object} report - Report from {@link summarizeInstructionFiles}.
 * @returns {object} Payload accepted by the diagnostics writer.
 */
export function diagnosticsFor(report) {
  const budgetSkipped = report.skipped.some(file => file.reason === 'budget');
  const identityTooLarge = Boolean(report.identity && !report.identity.injected && report.identity.reason === 'too-large');
  // A missing file only counts when its switch was on; optional files never do.
  const missingRequired = report.missing.length > 0;
  const degraded = budgetSkipped || identityTooLarge || missingRequired;
  return {
    count: report.files.length,
    sizeBytes: report.used,
    state: degraded ? 'skipped' : 'ok',
    code: budgetSkipped ? 'budget' : identityTooLarge ? 'identity-too-large' : missingRequired ? 'missing' : 'ok',
  };
}
