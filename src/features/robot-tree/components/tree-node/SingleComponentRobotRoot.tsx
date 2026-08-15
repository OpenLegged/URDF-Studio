import { Cuboid, Eye, EyeOff, LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { TranslationKeys } from '@/shared/i18n';
import type { WorkspacePropertyPatch } from '@/store/workspace/types';
import type { AssemblyComponent, EntityRef } from '@/types';
import { runOnActivationKey } from '../../utils/treeSelectionHelpers';

type ComponentRef = Extract<EntityRef, { type: 'component' }>;

interface SingleComponentRobotRootProps {
  component: AssemblyComponent;
  rowStateClass: string;
  readOnly: boolean;
  t: TranslationKeys;
  onSelect: () => void;
  onHover: () => void;
  onClearHover: () => void;
  onUpdate: (ref: ComponentRef, patch: WorkspacePropertyPatch) => void;
  onRobotNameChange: (ref: ComponentRef, name: string) => void;
}

export function SingleComponentRobotRoot({
  component,
  rowStateClass,
  readOnly,
  t,
  onSelect,
  onHover,
  onClearHover,
  onUpdate,
  onRobotNameChange,
}: SingleComponentRobotRootProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const componentRef: ComponentRef = { type: 'component', componentId: component.id };

  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  const beginRename = () => {
    if (readOnly || component.editorLocked === true) return;
    setDraft(component.robot.name);
    setEditing(true);
  };
  const commitRename = (value = draft) => {
    const name = value.trim();
    if (name && name !== component.robot.name) {
      onRobotNameChange(componentRef, name);
    }
    setEditing(false);
  };

  return (
    <div
      data-testid={`tree-robot-root-${component.id}`}
      className={`group mx-1 my-0.5 flex items-center rounded-md bg-element-bg px-2 py-1 text-text-primary transition-colors ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${rowStateClass}`}
      onClick={readOnly ? undefined : onSelect}
      onMouseEnter={readOnly ? undefined : onHover}
      onMouseLeave={readOnly ? undefined : onClearHover}
      onDoubleClick={readOnly ? undefined : beginRename}
      onKeyDown={readOnly
        ? undefined
        : (event) => runOnActivationKey(event, onSelect)}
      role={readOnly ? undefined : 'button'}
      aria-label={component.robot.name}
      tabIndex={readOnly ? undefined : 0}
    >
      <Cuboid size={14} className="mr-1.5 shrink-0 text-system-blue" />
      {editing ? (
        <input
          ref={inputRef}
          aria-label={`rename-robot-${component.id}`}
          value={draft}
          className="select-text text-[11px] font-medium leading-normal flex-1 min-w-0 px-1 py-0.5 rounded border outline-none transition-colors bg-input-bg border-border-strong text-text-primary focus:border-system-blue"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={(event) => commitRename(event.currentTarget.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename();
            if (event.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate text-[11px] font-medium leading-normal"
          title={component.robot.name}
        >
          {component.robot.name}
        </span>
      )}
      {!readOnly ? (
        <div className="ml-1 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={`toggle-component-${component.id}`}
            className="h-5 w-5 rounded p-1 text-text-tertiary transition-colors hover:bg-system-blue/10 hover:text-text-primary dark:hover:bg-system-blue/20"
            title={component.visible !== false ? t.hide : t.show}
            onClick={(event) => {
              event.stopPropagation();
              onUpdate(componentRef, { visible: component.visible === false });
            }}
          >
            {component.visible !== false ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button
            type="button"
            aria-label={`toggle-component-editor-lock-${component.id}`}
            aria-pressed={component.editorLocked === true}
            className={`h-5 w-5 rounded p-1 transition-colors ${
              component.editorLocked === true
                ? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-300'
                : 'text-text-tertiary hover:bg-system-blue/10 hover:text-text-primary dark:hover:bg-system-blue/20'
            }`}
            title={component.editorLocked === true ? t.unlockEditing : t.lockEditing}
            onClick={(event) => {
              event.stopPropagation();
              onUpdate(componentRef, { editorLocked: component.editorLocked !== true });
            }}
          >
            {component.editorLocked === true
              ? <LockKeyhole size={12} />
              : <LockKeyholeOpen size={12} />}
          </button>
        </div>
      ) : null}
    </div>
  );
}
