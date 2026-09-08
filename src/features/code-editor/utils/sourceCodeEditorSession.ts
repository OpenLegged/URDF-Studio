export interface SourceCodeEditorSessionBoundary {
  documentId: string;
  validationEnabled: boolean;
}

export interface SourceCodeDirtyRange {
  startOffset: number;
  endOffset: number;
}

export interface SourceCodeEditorContentChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

export interface SourceCodeEditorApplyRequest {
  /** Source text the editor session was based on before local edits began. */
  baseContent?: string;
  dirtyRanges?: SourceCodeDirtyRange[];
}

export function shouldResetSourceCodeEditorSession(
  previousBoundary: SourceCodeEditorSessionBoundary | null,
  nextBoundary: SourceCodeEditorSessionBoundary,
): boolean {
  if (!previousBoundary) {
    return true;
  }

  return (
    previousBoundary.documentId !== nextBoundary.documentId ||
    previousBoundary.validationEnabled !== nextBoundary.validationEnabled
  );
}

function normalizeDirtyRange(range: SourceCodeDirtyRange): SourceCodeDirtyRange {
  const startOffset = Math.max(0, Math.min(range.startOffset, range.endOffset));
  const endOffset = Math.max(startOffset, Math.max(range.startOffset, range.endOffset));
  return { startOffset, endOffset };
}

function mergeDirtyRanges(ranges: SourceCodeDirtyRange[]): SourceCodeDirtyRange[] {
  if (ranges.length <= 1) {
    return ranges.map(normalizeDirtyRange);
  }

  const sortedRanges = ranges
    .map(normalizeDirtyRange)
    .sort((left, right) => left.startOffset - right.startOffset);
  const mergedRanges: SourceCodeDirtyRange[] = [sortedRanges[0]];

  for (let index = 1; index < sortedRanges.length; index += 1) {
    const nextRange = sortedRanges[index];
    const currentRange = mergedRanges[mergedRanges.length - 1];

    if (nextRange.startOffset <= currentRange.endOffset) {
      currentRange.endOffset = Math.max(currentRange.endOffset, nextRange.endOffset);
      continue;
    }

    mergedRanges.push(nextRange);
  }

  return mergedRanges;
}

function rebaseDirtyRangeThroughChange(
  range: SourceCodeDirtyRange,
  change: SourceCodeEditorContentChange,
): SourceCodeDirtyRange {
  const normalizedRange = normalizeDirtyRange(range);
  const changeStart = Math.max(0, change.rangeOffset);
  const removedEnd = changeStart + Math.max(0, change.rangeLength);
  const insertedEnd = changeStart + change.text.length;
  const delta = change.text.length - Math.max(0, change.rangeLength);

  if (normalizedRange.endOffset <= changeStart) {
    return normalizedRange;
  }

  if (normalizedRange.startOffset >= removedEnd) {
    return {
      startOffset: normalizedRange.startOffset + delta,
      endOffset: normalizedRange.endOffset + delta,
    };
  }

  return {
    startOffset: Math.min(normalizedRange.startOffset, changeStart),
    endOffset: Math.max(insertedEnd, normalizedRange.endOffset + delta),
  };
}

export function accumulateSourceCodeDirtyRanges(
  existingRanges: SourceCodeDirtyRange[],
  changes: SourceCodeEditorContentChange[],
): SourceCodeDirtyRange[] {
  if (changes.length === 0) {
    return mergeDirtyRanges(existingRanges);
  }

  let nextRanges = mergeDirtyRanges(existingRanges);
  const sortedChanges = [...changes].sort((left, right) => right.rangeOffset - left.rangeOffset);

  sortedChanges.forEach((change) => {
    nextRanges = mergeDirtyRanges([
      ...nextRanges.map((range) => rebaseDirtyRangeThroughChange(range, change)),
      {
        startOffset: Math.max(0, change.rangeOffset),
        endOffset: Math.max(0, change.rangeOffset) + change.text.length,
      },
    ]);
  });

  return nextRanges;
}
