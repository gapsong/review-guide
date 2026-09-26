import { ReviewUnit } from "./reviewUnit";
import { DiffLine } from "./unifiedDiff";

// A weakened test changes the scoreboard, so it is always critical, whatever Claude says.
// Returns why the unit weakens a test, or undefined.
export function findTestWeakening(unit: ReviewUnit): string | undefined {
  if (!unit.isTestFile) {
    return undefined;
  }
  const removed = unit.lines.filter((line) => line.kind === "removed");
  const added = unit.lines.filter((line) => line.kind === "added");
  return removedAssertion(removed, added) ?? loosenedTolerance(removed, added) ?? addedSkip(added);
}

const assertionPattern =
  /\bassert\w*\b|\bexpect\s*\(|\.should\b|\bself\.assert\w+|\btesting\.assert\w*|\bt\.(Error|Errorf|Fatal|Fatalf|Fail)\b|\b(EXPECT|ASSERT)_\w+/;

function removedAssertion(removed: DiffLine[], added: DiffLine[]): string | undefined {
  const removedAssertions = removed.filter((line) => assertionPattern.test(line.text));
  const addedAssertions = added.filter((line) => assertionPattern.test(line.text));
  if (removedAssertions.length > addedAssertions.length) {
    return `Weakened test: removes an assertion (\`${removedAssertions[0].text.trim()}\`).`;
  }
  return undefined;
}

// Tolerances where a bigger number is looser, and "digits" settings where a smaller number is looser.
const toleranceNames = ["atol", "rtol", "abs_tol", "rel_tol", "tol", "tolerance", "eps", "epsilon", "delta", "abs", "rel", "threshold", "margin"];
const digitNames = ["places", "decimal", "digits", "precision"];
const tolerancePattern = new RegExp(`\\b(${[...toleranceNames, ...digitNames].join("|")})\\s*[=:]\\s*(-?[0-9][0-9_.]*(?:[eE][-+]?[0-9]+)?)`, "g");

function loosenedTolerance(removed: DiffLine[], added: DiffLine[]): string | undefined {
  const before = tolerancesIn(removed);
  const after = tolerancesIn(added);
  for (const [name, oldValue] of before) {
    const newValue = after.get(name);
    if (newValue === undefined) {
      continue;
    }
    const looser = digitNames.includes(name) ? newValue < oldValue : newValue > oldValue;
    if (looser) {
      return `Weakened test: loosens the tolerance ${name} from ${oldValue} to ${newValue}.`;
    }
  }
  return undefined;
}

function tolerancesIn(lines: DiffLine[]): Map<string, number> {
  const tolerances = new Map<string, number>();
  for (const line of lines) {
    for (const match of line.text.matchAll(tolerancePattern)) {
      tolerances.set(match[1], Number(match[2].replace(/_/g, "")));
    }
  }
  return tolerances;
}

const skipPattern =
  /@pytest\.mark\.(skip|skipif|xfail)\b|\bpytest\.(skip|xfail|importorskip)\(|@unittest\.(skip|skipIf|skipUnless|expectedFailure)\b|\bself\.skipTest\(|\b(it|test|describe|context)\.(skip|todo)\(|\bx(it|describe|test)\(|@Disabled\b|@Ignore\b|\bt\.Skip(Now|f)?\(|#\[ignore\]/;

function addedSkip(added: DiffLine[]): string | undefined {
  const skip = added.find((line) => skipPattern.test(line.text));
  return skip ? `Weakened test: adds a skip (\`${skip.text.trim()}\`).` : undefined;
}
