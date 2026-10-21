import React from 'react';

import { translations, type Language } from '@/shared/i18n';
import { Button, Dialog } from '@/shared/components/ui';

interface DisconnectedWorkspaceUrdfExportDialogProps {
  isOpen: boolean;
  lang: Language;
  componentCount: number;
  connectedGroupCount: number;
  isExporting?: boolean;
  onClose: () => void;
  onExportMultiple: () => void;
}

function replaceTemplate(
  template: string,
  replacements: Record<string, string | number>,
): string {
  return Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export const DisconnectedWorkspaceUrdfExportDialog: React.FC<DisconnectedWorkspaceUrdfExportDialogProps> = ({
  isOpen,
  lang,
  componentCount,
  connectedGroupCount,
  isExporting = false,
  onClose,
  onExportMultiple,
}) => {
  const t = translations[lang];

  return (
    <Dialog
      closeLabel={t.close}
      isOpen={isOpen}
      onClose={() => {
        if (!isExporting) {
          onClose();
        }
      }}
      title={t.disconnectedWorkspaceUrdfExportTitle}
      width="w-[520px]"
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isExporting}
          >
            {t.continueEditing}
          </Button>
          <Button
            type="button"
            onClick={onExportMultiple}
            isLoading={isExporting}
          >
            {t.exportMultipleUrdfs}
          </Button>
        </div>
      )}
    >
      <p className="text-sm leading-6 text-text-secondary">
        {replaceTemplate(t.disconnectedWorkspaceUrdfExportMessage, {
          componentCount,
          connectedGroupCount,
        })}
      </p>
    </Dialog>
  );
};

export default DisconnectedWorkspaceUrdfExportDialog;
