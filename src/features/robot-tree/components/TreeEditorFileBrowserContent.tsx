import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import type { RobotFile } from '@/types';
import type { FileTreeNode } from '../utils';
import { FileTreeNodeComponent, type LibraryDeleteTarget } from './FileTreeNode';
import type { TreeEditorTranslations } from './treeEditorTypes';

interface TreeEditorFileBrowserContentProps {
  availableFiles: RobotFile[];
  canDeleteAllLibraryFiles?: boolean;
  editingFolderPath?: string | null;
  expandedFolders: Set<string>;
  fileTree: FileTreeNode[];
  folderRenameDraft: string;
  folderRenameInputRef: RefObject<HTMLInputElement | null>;
  height: number;
  isDragging: boolean;
  isOpen: boolean;
  showAddAsComponent: boolean;
  onAddComponent?: (file: RobotFile) => void;
  onCancelFolderRename: () => void;
  onCommitFolderRename: () => void;
  onDeleteAll?: () => void;
  onDeleteFromLibrary?: (target: LibraryDeleteTarget) => void;
  onLoadRobot?: (file: RobotFile) => void;
  onFileContextMenu: (event: ReactMouseEvent, file: RobotFile) => void;
  onFolderRenameDraftChange: (value: string) => void;
  onFolderContextMenu: (event: ReactMouseEvent, folderPath: string) => void;
  onToggleOpen: () => void;
  shouldFillSpace: boolean;
  t: TreeEditorTranslations;
  toggleFolder: (path: string) => void;
}

export function TreeEditorFileBrowserContent({
  availableFiles,
  canDeleteAllLibraryFiles = false,
  editingFolderPath,
  expandedFolders,
  fileTree,
  folderRenameDraft,
  folderRenameInputRef,
  height,
  isDragging,
  isOpen,
  showAddAsComponent,
  onAddComponent,
  onCancelFolderRename,
  onCommitFolderRename,
  onDeleteAll,
  onDeleteFromLibrary,
  onLoadRobot,
  onFileContextMenu,
  onFolderRenameDraftChange,
  onFolderContextMenu,
  onToggleOpen,
  shouldFillSpace,
  t,
  toggleFolder,
}: TreeEditorFileBrowserContentProps) {
  return (
    <div
      className={`@container flex flex-col bg-panel-bg border-b border-border-black ${shouldFillSpace ? 'flex-1 min-h-0' : 'shrink-0'} ${isDragging ? '' : 'transition-[height] duration-200'}`}
      style={shouldFillSpace ? undefined : { height: isOpen ? `${height}px` : 'auto' }}
    >
      <div className="flex h-8 items-center gap-2 bg-element-bg px-2.5 dark:bg-element-bg">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer select-none items-center justify-between border-0 bg-transparent p-0 text-left"
          onClick={onToggleOpen}
        >
          <div className="flex min-w-0 items-center gap-2">
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            )}
            <span className="text-[11px] font-semibold leading-none tracking-[0.02em] text-text-secondary">
              {t.fileBrowser}
            </span>
          </div>
          <span className="ml-2 shrink-0 text-[9px] leading-none text-text-tertiary">
            {availableFiles.length}
          </span>
        </button>
        {canDeleteAllLibraryFiles && onDeleteAll && (
          <button
            type="button"
            onClick={onDeleteAll}
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-danger-border bg-danger-soft px-1.5 text-[9px] font-semibold leading-none text-danger transition-colors hover:bg-danger-soft hover:text-danger-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/20"
            title={t.deleteAllLibraryFiles}
            aria-label={t.deleteAllLibraryFiles}
          >
            <Trash2 size={10} strokeWidth={2.25} />
            <span className="hidden @[260px]:inline">{t.deleteAllLibraryFiles}</span>
          </button>
        )}
      </div>

      {isOpen && (
        <div
          className="flex-1 overflow-y-auto overflow-x-auto custom-scrollbar py-1"
          onContextMenu={(event) => {
            event.preventDefault();
          }}
        >
          {availableFiles.length === 0 ? (
            <div className="ui-static-copy-guard flex min-h-full items-center justify-center px-3 text-center text-xs italic whitespace-pre-line text-text-tertiary">
              {t.dropOrImport}
            </div>
          ) : (
            <div className="min-w-max">
              {fileTree.map((node) => (
                <div
                  key={node.path}
                  style={{ containIntrinsicSize: 'auto 40px', contentVisibility: 'auto' }}
                >
                  <FileTreeNodeComponent
                    node={node}
                    depth={0}
                    editingFolderPath={editingFolderPath}
                    folderRenameDraft={folderRenameDraft}
                    folderRenameInputRef={folderRenameInputRef}
                    onLoadRobot={onLoadRobot}
                    onAddAsComponent={showAddAsComponent ? onAddComponent : undefined}
                    onCancelFolderRename={onCancelFolderRename}
                    onCommitFolderRename={onCommitFolderRename}
                    onDeleteFromLibrary={onDeleteFromLibrary}
                    onFileContextMenu={onFileContextMenu}
                    onFolderRenameDraftChange={onFolderRenameDraftChange}
                    onFolderContextMenu={onFolderContextMenu}
                    expandedFolders={expandedFolders}
                    toggleFolder={toggleFolder}
                    showAddAsComponent={showAddAsComponent}
                    t={t}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
