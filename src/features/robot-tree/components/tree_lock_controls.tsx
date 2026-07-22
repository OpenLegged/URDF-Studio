import { LockKeyhole, LockKeyholeOpen } from 'lucide-react';

import type { TranslationKeys } from '@/shared/i18n';

export type InheritedEditorLockSource = 'component' | 'ancestor';

interface LinkEditorLockButtonProps {
  ariaLabel: string;
  editorLocked: boolean;
  inheritedSource?: InheritedEditorLockSource;
  selected: boolean;
  selectedActionClass: string;
  t: TranslationKeys;
  onToggle: () => void;
}

export function LinkEditorLockButton({
  ariaLabel,
  editorLocked,
  inheritedSource,
  selected,
  selectedActionClass,
  t,
  onToggle,
}: LinkEditorLockButtonProps) {
  const inherited = inheritedSource !== undefined;
  const className = editorLocked
    ? inherited
      ? 'cursor-not-allowed bg-amber-500/10 text-amber-600/70 dark:text-amber-300/70'
      : 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-300'
    : selected
      ? selectedActionClass
      : 'text-text-tertiary hover:bg-system-blue/10 hover:text-text-primary dark:hover:bg-system-blue/20';
  const title = inheritedSource === 'component'
    ? t.editingLockedByComponent
    : inheritedSource === 'ancestor'
      ? t.editingLockedByAncestor
      : editorLocked
        ? t.unlockEditing
        : t.lockEditing;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={editorLocked}
      disabled={inherited}
      className={`h-5 w-5 rounded p-1 transition-colors ${className}`}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        if (!inherited) onToggle();
      }}
    >
      {editorLocked ? <LockKeyhole size={12} /> : <LockKeyholeOpen size={12} />}
    </button>
  );
}
