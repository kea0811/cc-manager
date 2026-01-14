import * as Diff from 'diff';

export interface TextChange {
  type: 'add' | 'remove' | 'unchanged';
  value: string;
  lineNumber?: number;
}

export interface DiffResult {
  changes: TextChange[];
  hasChanges: boolean;
  addedLines: number;
  removedLines: number;
}

// Wrapper for testing - allows mocking
export const diffLib = {
  applyPatch: (original: string, patch: string) => Diff.applyPatch(original, patch),
};

export const computeDiff = (oldText: string, newText: string): DiffResult => {
  const changes = Diff.diffLines(oldText, newText);
  const result: TextChange[] = [];
  let addedLines = 0;
  let removedLines = 0;
  let lineNumber = 1;

  for (const change of changes) {
    if (change.added) {
      result.push({ type: 'add', value: change.value, lineNumber });
      addedLines += change.count || 0;
    } else if (change.removed) {
      result.push({ type: 'remove', value: change.value, lineNumber });
      removedLines += change.count || 0;
    } else {
      result.push({ type: 'unchanged', value: change.value, lineNumber });
    }
    if (!change.removed) {
      lineNumber += change.count || 0;
    }
  }

  return {
    changes: result,
    hasChanges: addedLines > 0 || removedLines > 0,
    addedLines,
    removedLines,
  };
};

export const applyPatch = (original: string, patch: string): string | null => {
  try {
    const result = diffLib.applyPatch(original, patch);
    return result === false ? null : result;
  } catch {
    return null;
  }
};

export const createPatch = (
  filename: string,
  oldContent: string,
  newContent: string
): string => {
  return Diff.createPatch(filename, oldContent, newContent);
};
