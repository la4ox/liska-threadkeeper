/**
 * Fitness function: no circular dependencies between subsystems (ADR-012).
 *
 * Assigns every src file to its top-level subsystem and asserts there is no
 * import cycle between those subsystems. Cyclic coupling is the classic
 * "architecture erosion" signal the book's beFreeOfCycles() rule guards against.
 *
 * Uses assignedFrom() with project-root-anchored absolute globs. A wildcard
 * prefix skips hidden worktree ancestors under picomatch's default dot=false,
 * so every declared slice also has an explicit non-vacuity assertion.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { project, slices } from '@nielspeter/ts-archunit';

const tsconfigPath = path.resolve(import.meta.dirname, '../../tsconfig.json');
const sourceRoot = path.resolve(import.meta.dirname, '../../src').replace(/\\/g, '/');
const p = project(tsconfigPath);

const subsystems = {
  archive: `${sourceRoot}/archive/**`,
  shared: `${sourceRoot}/shared/**`,
  lib: `${sourceRoot}/lib/**`,
  content: `${sourceRoot}/content/**`,
  background: `${sourceRoot}/background/**`,
  popup: `${sourceRoot}/popup/**`,
  offscreen: `${sourceRoot}/offscreen/**`,
};

describe('architecture: cycles', () => {
  it('assigns at least one source file to every declared subsystem', () => {
    // SliceRuleBuilder does not expose resolved slices publicly. Inspect the
    // pinned implementation's own assignedFrom() result so this guard cannot
    // disagree with the matcher used by beFreeOfCycles().
    const resolved = Reflect.get(slices(p).assignedFrom(subsystems), '_slices') as readonly {
      readonly name: string;
      readonly files: readonly unknown[];
    }[];
    expect(resolved.map(slice => slice.name)).toEqual(Object.keys(subsystems));
    for (const name of Object.keys(subsystems)) {
      const slice = resolved.find(candidate => candidate.name === name);
      expect(
        slice?.files.length ?? 0,
        `${name} subsystem must not be a vacuous architecture slice`
      ).toBeGreaterThan(0);
    }
  });

  it('src subsystems must be free of dependency cycles', () => {
    slices(p)
      .assignedFrom(subsystems)
      .should()
      .beFreeOfCycles()
      .because('circular coupling between subsystems erodes the architecture')
      .check();
  });
});
