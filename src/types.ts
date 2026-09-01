/** Core data types shared by the loader, the rules and the reporters. */

import type { JsonValue, Loc } from './jsonc.js';

/**
 * How much a finding should worry the reader.
 *
 * - `error` — the option is rejected by `tsc`, or contradicts another option in
 *   a way that makes the build mean something other than what it says.
 * - `warning` — the build succeeds and silently behaves differently from the
 *   obvious reading. This is the category the tool exists for.
 * - `info` — a defensible choice with a consequence worth knowing.
 */
export type Severity = 'error' | 'warning' | 'info';

/** The rank used for `--min-severity` comparisons. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  info: 0,
  warning: 1,
  error: 2,
};

/**
 * One diagnosis.
 *
 * The three prose fields are the whole point of the tool and are kept separate
 * on purpose: `title` names the *consequence*, `consequence` explains the
 * mechanism, and `fix` says what to type. A finding that only restates the
 * setting ("strict is off") has failed.
 */
export interface Finding {
  /** Stable identifier, e.g. `TSD002`. Safe to grep for and to suppress by. */
  readonly code: string;
  readonly severity: Severity;
  /** One line, phrased as what happens, not as what the setting is. */
  readonly title: string;
  /** The compiler option this is about, when there is exactly one. */
  readonly option?: string | undefined;
  /** Absolute path of the file that actually declares the option. */
  readonly file: string;
  /** Location of the option within `file`, when it is written there literally. */
  readonly loc?: Loc | undefined;
  /** Why the build now behaves differently from the obvious reading. */
  readonly consequence: string;
  /** The concrete change to make, or the reason not to. */
  readonly fix: string;
}

/** A compiler option as it survived the `extends` chain. */
export interface OptionRecord {
  readonly name: string;
  readonly value: JsonValue;
  /** The file that declared the winning value — not necessarily the entry file. */
  readonly file: string;
  readonly loc: Loc;
  /**
   * Files that declared a value for this option and lost, root-most first.
   * Non-empty means an `extends` chain overrode something.
   */
  readonly overridden: readonly string[];
}

/** A `references` entry, with its `path` resolved to a config file. */
export interface ProjectReference {
  readonly rawPath: string;
  /** Absolute path of the referenced config, or `undefined` if unresolvable. */
  readonly resolved: string | undefined;
  /** Whether the referenced project sets `composite: true`. */
  readonly composite: boolean | undefined;
  readonly loc: Loc;
}

/** A tsconfig after `extends` resolution. */
export interface ResolvedConfig {
  /** Absolute path of the file the user asked about. */
  readonly fileName: string;
  /** Winning compiler options, keyed by option name. */
  readonly options: ReadonlyMap<string, OptionRecord>;
  /** Top-level keys other than `compilerOptions`, after inheritance. */
  readonly topLevel: ReadonlyMap<string, OptionRecord>;
  /** Every file in the `extends` chain, root-most first, entry file last. */
  readonly chain: readonly string[];
  readonly references: readonly ProjectReference[];
  /** Problems found while reading and merging, already phrased as findings. */
  readonly problems: readonly Finding[];
}
