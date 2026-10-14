import React from 'react';
import { Download } from 'lucide-react';
import { Button, Dialog, IconButton, Input, SegmentedControl } from '@/shared/components/ui';
import { translations, type Language } from '@/shared/i18n';
import { downloadBlob } from '@/shared/utils/downloadBlob';
import {
  buildJointPose,
  jointPoseFileName,
  serializeJointPose,
  type JointPose,
  type JointPoseFormat,
} from '@/shared/utils/jointPoseExport';
import type { JointPanelStore } from '@/shared/utils/jointPanelStore';
import { hasSingleDofJoints } from '@/shared/utils/jointTypes';
import type { JointPanelRobot } from './JointPanelContent';

interface JointPoseExportProps {
  robot: JointPanelRobot | null | undefined;
  jointPanelStore: JointPanelStore;
  lang: Language;
  robotName?: string;
  compact?: boolean;
}

export function JointPoseExport({
  robot,
  robotName = robot?.name ?? 'robot',
  jointPanelStore,
  lang,
  compact = false,
}: JointPoseExportProps) {
  const t = translations[lang];
  const [isOpen, setIsOpen] = React.useState(false);
  const [pose, setPose] = React.useState<JointPose | null>(null);
  const [format, setFormat] = React.useState<JointPoseFormat>('json');
  const [fileName, setFileName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const resolvedFileName = jointPoseFileName(fileName, format);

  const open = () => {
    setError(null);
    setIsOpen(true);
    setPose(null);
    try {
      if (!robot) throw new Error('Cannot export a pose without a robot.');
      const snapshot = buildJointPose(robot, jointPanelStore.getSnapshot().jointAngles, robotName);
      setPose(snapshot);
      setFileName(`${snapshot.robot}_pose`);
    } catch (cause) {
      console.error('[JointPoseExport] Failed to capture current pose.', cause);
      setError(t.poseExportFailed);
    }
  };

  const close = () => setIsOpen(false);
  const download = () => {
    if (!pose || !resolvedFileName) return;
    try {
      const content = serializeJointPose(pose, format);
      const type = format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8';
      downloadBlob(new Blob([content], { type }), resolvedFileName);
      close();
    } catch (cause) {
      console.error('[JointPoseExport] Failed to export current pose.', cause);
      setError(t.poseExportFailed);
    }
  };

  return (
    <>
      <IconButton
        variant="toolbar"
        size="xs"
        title={t.exportCurrentPose}
        aria-label={t.exportCurrentPose}
        disabled={!hasSingleDofJoints(robot?.joints)}
        className={`${compact ? 'h-5 w-5' : 'h-6 w-6'} border border-border-black/60 bg-panel-bg text-text-secondary`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          open();
        }}
      >
        <Download className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      </IconButton>
      <Dialog
        isOpen={isOpen}
        onClose={close}
        title={t.exportCurrentPose}
        closeLabel={t.close}
        width="w-[460px] max-w-[calc(100vw-32px)]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              {t.cancel}
            </Button>
            <Button
              type="button"
              onClick={download}
              disabled={!pose || !resolvedFileName}
              icon={<Download className="h-3.5 w-3.5" />}
            >
              {t.export} {format.toUpperCase()}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 p-4">
          {error && (
            <p role="alert" className="text-ui-label text-danger">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3 text-ui-label text-text-secondary">
            <span className="truncate">{pose?.robot ?? robotName}</span>
            <span className="shrink-0">
              {pose?.joints.length ?? 0} {t.poseJointCount}
            </span>
          </div>
          <div className="space-y-1.5">
            <span className="text-ui-label text-text-secondary">{t.poseFileFormat}</span>
            <SegmentedControl
              value={format}
              onChange={setFormat}
              size="sm"
              ariaLabel={t.poseFileFormat}
              options={[
                { value: 'json', label: 'JSON' },
                { value: 'csv', label: 'CSV' },
              ]}
            />
          </div>
          <div className="flex items-end gap-2">
            <Input
              label={t.poseFileName}
              value={fileName}
              error={fileName && !resolvedFileName ? t.poseInvalidFileName : undefined}
              onChange={(event) => setFileName(event.target.value)}
            />
            <span className="pb-2 text-ui-label font-mono text-text-tertiary">.{format}</span>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-ui-label text-text-secondary">
              <span>{t.poseJointValues}</span>
              <span className="text-ui-caption text-text-tertiary">{t.poseUnits}</span>
            </div>
            <div className="max-h-[240px] overflow-auto rounded-lg border border-border-black custom-scrollbar">
              <table className="w-full text-ui-label">
                <thead className="sticky top-0 bg-element-bg text-text-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t.poseJointName}</th>
                    <th className="px-3 py-2 text-right font-medium">{t.posePosition}</th>
                    <th className="px-3 py-2 text-right font-medium">{t.poseUnit}</th>
                  </tr>
                </thead>
                <tbody>
                  {pose?.joints.map((joint) => (
                    <tr
                      key={joint.id}
                      className="border-t border-border-black/40 text-text-primary"
                    >
                      <td className="break-all px-3 py-1.5 font-mono">{joint.name}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {joint.position.toFixed(4)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-text-tertiary">{joint.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-ui-caption leading-relaxed text-text-tertiary">{t.poseExportHint}</p>
        </div>
      </Dialog>
    </>
  );
}
