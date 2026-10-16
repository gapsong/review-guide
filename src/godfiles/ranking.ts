// The score of a candidate: the mean of its percentile ranks among all candidates on three signals.
// Code lines are not a signal: the owner's rule says length alone never makes a god file.

export interface RankSignals {
  // undefined when breadth is not measured for the file's language; that signal is left out of
  // its mean instead of counting as 0.
  namesUsedOutside: number | undefined;
  coChangeAreas: number;
  commits: number;
}

export type SignalName = keyof RankSignals;

export const signalNames: SignalName[] = ["namesUsedOutside", "coChangeAreas", "commits"];

export interface Ranked<T> {
  candidate: T;
  // 0 to 1; 1 is the top on every signal.
  score: number;
  // Per signal: the share of candidates this one is ahead of (ties count half), 0 to 1.
  percentiles: Partial<Record<SignalName, number>>;
}

export function rankCandidates<T>(candidates: T[], signalsOf: (candidate: T) => RankSignals, tieBreakOf: (candidate: T) => string): Ranked<T>[] {
  const signals = candidates.map(signalsOf);
  const ranked = candidates.map((candidate, index) => {
    const percentiles: Partial<Record<SignalName, number>> = {};
    for (const name of signalNames) {
      const value = signals[index][name];
      if (value !== undefined) {
        percentiles[name] = percentileOf(value, signals.map((other) => other[name]).filter((other): other is number => other !== undefined));
      }
    }
    const known = Object.values(percentiles);
    const score = known.length === 0 ? 0 : known.reduce((sum, value) => sum + value, 0) / known.length;
    return { candidate, score, percentiles };
  });
  return ranked.sort((first, second) => second.score - first.score || tieBreakOf(first.candidate).localeCompare(tieBreakOf(second.candidate)));
}

// The midrank percentile: how many values are below, plus half of the equal ones (itself included).
function percentileOf(value: number, values: number[]): number {
  const below = values.filter((other) => other < value).length;
  const equal = values.filter((other) => other === value).length;
  return (below + equal / 2) / values.length;
}
