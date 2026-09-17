import { Button, Dialog } from '@/shared/components/ui';
import type { TranslationKeys } from '@/shared/i18n';

interface TreeEditorDialogsProps {
  deleteAllOpen: boolean;
  loadRobotOpen: boolean;
  loadRobotPending: boolean;
  hasPendingLoadRobot: boolean;
  t: TranslationKeys;
  onCloseDeleteAll: () => void;
  onConfirmDeleteAll: () => void;
  onCloseLoadRobot: () => void;
  onLoadRobot: (intent: 'discard' | 'preview') => void;
}

/** Dialog visuals loaded only after a tree workflow requests one. */
export function TreeEditorDialogs({
  deleteAllOpen,
  loadRobotOpen,
  loadRobotPending,
  hasPendingLoadRobot,
  t,
  onCloseDeleteAll,
  onConfirmDeleteAll,
  onCloseLoadRobot,
  onLoadRobot,
}: TreeEditorDialogsProps) {
  return (
    <>
      <Dialog
        isOpen={deleteAllOpen}
        onClose={onCloseDeleteAll}
        title={t.deleteAllLibraryFilesConfirmTitle}
        width="w-[420px]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onCloseDeleteAll}>
              {t.cancel}
            </Button>
            <Button type="button" variant="danger" onClick={onConfirmDeleteAll}>
              {t.confirm}
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-text-secondary">
          {t.deleteAllLibraryFilesConfirmMessage}
        </p>
      </Dialog>

      <Dialog
        isOpen={loadRobotOpen}
        onClose={onCloseLoadRobot}
        title={t.simpleModeSwitchDraftConfirmTitle}
        width="w-[460px]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onCloseLoadRobot}
              disabled={loadRobotPending}
            >
              {t.cancel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onLoadRobot('discard')}
              disabled={loadRobotPending || !hasPendingLoadRobot}
            >
              {t.discardAndOpen}
            </Button>
            <Button
              type="button"
              onClick={() => onLoadRobot('preview')}
              isLoading={loadRobotPending}
              disabled={!hasPendingLoadRobot}
            >
              {t.previewTargetModel}
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-text-secondary">
          {t.simpleModeSwitchDraftConfirmMessage}
        </p>
      </Dialog>
    </>
  );
}
