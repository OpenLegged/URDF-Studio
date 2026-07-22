import React, { useState, useCallback, useEffect } from 'react';
import { Upload, Package, FileCode, Layers, Lock, Braces, Loader2 } from 'lucide-react';
import {
  DraggableWindow,
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
  FLOATING_WINDOW_TITLE_CLASS,
} from '@/shared/components/DraggableWindow';
import { CLOSE_BUTTON_DANGER_TERTIARY_CLASS } from '@/shared/components/ui/closeButtonStyles';
import { useDraggableWindow } from '@/shared/hooks/useDraggableWindow';
import { translations } from '@/shared/i18n';
import { useManagedWindowLayer } from '@/store';
import type { ExportProgressState } from '../../types';
import type { MjcfActuatorType } from '@/core/parsers/mjcf/mjcfGenerator';
import { ExportProgressView } from '../ExportProgressView';
import {
  DEFAULT_CONFIG,
  EXPORT_FORMATS,
  getExportFormatSupports,
} from './config';
import {
  Row,
  SectionLabel,
  SegmentedChoiceField,
  SelectField,
  TextField,
  Toggle,
} from './fields';
import { getStlPreset, STLQualitySelector, type StlPresetKey } from './stlQualitySelector';
import type {
  ExportDialogConfig,
  ExportDialogProps,
  ExportFormat,
  GazeboBackend,
  MeshExportFormat,
  RosHwInterface,
  RosVersion,
  MjcfExportConfig,
  SdfExportConfig,
  UrdfExportConfig,
  UsdExportConfig,
  XacroExportConfig,
} from './types';

export type {
  ExportDialogConfig,
  ExportDialogProps,
  ExportFormat,
  GazeboBackend,
  MeshExportFormat,
  MjcfExportConfig,
  RosHwInterface,
  RosVersion,
  SdfExportConfig,
  UrdfExportConfig,
  UsdExportConfig,
  XacroExportConfig,
} from './types';

export const ExportDialog: React.FC<ExportDialogProps> = ({
  onClose,
  onExport,
  lang,
  isExporting = false,
  canExportUsd = false,
  defaultFormat = DEFAULT_CONFIG.format,
}) => {
  const t = translations[lang];
  const exportDialogWindowLayer = useManagedWindowLayer('exportDialog');
  const initialFormat = defaultFormat === 'project' ? DEFAULT_CONFIG.format : defaultFormat;
  const [config, setConfig] = useState<ExportDialogConfig>(() => ({
    ...DEFAULT_CONFIG,
    format: initialFormat,
  }));
  const [localExportProgress, setLocalExportProgress] = useState<ExportProgressState | null>(null);
  const [pendingExportFormat, setPendingExportFormat] = useState<ExportFormat | null>(null);
  const [qualityModes, setQualityModes] = useState<Record<MeshExportFormat, StlPresetKey>>(() => ({
    mjcf: getStlPreset(DEFAULT_CONFIG.mjcf.compressSTL, DEFAULT_CONFIG.mjcf.stlQuality),
    urdf: getStlPreset(DEFAULT_CONFIG.urdf.compressSTL, DEFAULT_CONFIG.urdf.stlQuality),
    xacro: getStlPreset(DEFAULT_CONFIG.xacro.compressSTL, DEFAULT_CONFIG.xacro.stlQuality),
    sdf: getStlPreset(DEFAULT_CONFIG.sdf.compressSTL, DEFAULT_CONFIG.sdf.stlQuality),
    usd: getStlPreset(DEFAULT_CONFIG.usd.compressMeshes, DEFAULT_CONFIG.usd.meshQuality),
  }));

  const windowState = useDraggableWindow({
    defaultSize: { width: 420, height: 560 },
    minSize: { width: 380, height: 440 },
    centerOnMount: true,
    enableMinimize: false,
    enableMaximize: false,
  });

  useEffect(() => {
    if (!isExporting) {
      setPendingExportFormat(null);
    }
  }, [isExporting]);

  const dialogWidth = windowState.size.width;
  const isCompactLayout = dialogWidth < 480;
  const isStackedLayout = dialogWidth < 420;
  const isCompactFormatPicker = dialogWidth < 400;
  const formatGridClassName = 'grid-cols-5';

  const setFormat = useCallback(
    (fmt: MeshExportFormat) => {
      if (fmt === 'usd' && !canExportUsd) return;
      setConfig((prev) => ({ ...prev, format: fmt }));
    },
    [canExportUsd],
  );

  const updateMjcf = useCallback(
    <K extends keyof MjcfExportConfig>(key: K, value: MjcfExportConfig[K]) => {
      setConfig((prev) => ({ ...prev, mjcf: { ...prev.mjcf, [key]: value } }));
    },
    [],
  );

  const updateUrdf = useCallback(
    <K extends keyof UrdfExportConfig>(key: K, value: UrdfExportConfig[K]) => {
      setConfig((prev) => ({ ...prev, urdf: { ...prev.urdf, [key]: value } }));
    },
    [],
  );

  const updateXacro = useCallback(
    <K extends keyof XacroExportConfig>(key: K, value: XacroExportConfig[K]) => {
      setConfig((prev) => ({ ...prev, xacro: { ...prev.xacro, [key]: value } }));
    },
    [],
  );

  const updateXacroRosVersion = useCallback((rosVersion: RosVersion) => {
    setConfig((prev) => ({
      ...prev,
      xacro: {
        ...prev.xacro,
        rosVersion,
        gazeboBackend: rosVersion === 'ros1' ? 'classic' : prev.xacro.gazeboBackend,
      },
    }));
  }, []);

  const updateSdf = useCallback(
    <K extends keyof SdfExportConfig>(key: K, value: SdfExportConfig[K]) => {
      setConfig((prev) => ({ ...prev, sdf: { ...prev.sdf, [key]: value } }));
    },
    [],
  );

  const updateUsd = useCallback(
    <K extends keyof UsdExportConfig>(key: K, value: UsdExportConfig[K]) => {
      setConfig((prev) => ({ ...prev, usd: { ...prev.usd, [key]: value } }));
    },
    [],
  );

  const updateIncludeSkeleton = useCallback((value: boolean) => {
    setConfig((prev) => ({ ...prev, includeSkeleton: value }));
  }, []);

  const updateQualityMode = useCallback((format: MeshExportFormat, mode: StlPresetKey) => {
    setQualityModes((prev) => (prev[format] === mode ? prev : { ...prev, [format]: mode }));
  }, []);

  const actuatorTypeOptions = [
    { value: 'position', label: t.exportActuatorPosition },
    { value: 'velocity', label: t.exportActuatorVelocity },
    { value: 'motor', label: t.exportActuatorMotor },
  ];
  const activeExportFormat = pendingExportFormat ?? config.format;
  const fallbackTotalSteps =
    activeExportFormat === 'project'
      ? 6
      : activeExportFormat === 'usd'
        ? config.usd.fileFormat === 'usda'
          ? 3
          : 4
        : activeExportFormat === 'mjcf'
          ? config.mjcf.includeMeshes
            ? 5
            : 4
          : (
                activeExportFormat === 'urdf'
                  ? config.urdf.includeMeshes
                  : activeExportFormat === 'xacro'
                    ? config.xacro.includeMeshes
                    : config.sdf.includeMeshes
              )
            ? 4
            : 3;
  const progressState = localExportProgress ?? {
    stepLabel: t.exportProgressPreparing,
    detail: t.exportProgressPreparingDetail,
    progress: 0.08,
    currentStep: 1,
    totalSteps: fallbackTotalSteps,
    indeterminate: true,
  };

  const startExport = useCallback(
    (format: ExportFormat) => {
      setPendingExportFormat(format);
      setLocalExportProgress(null);
      void onExport(
        { ...config, format },
        {
          onProgress: setLocalExportProgress,
        },
      );
    },
    [config, onExport],
  );

  const handleExportClick = useCallback(() => {
    startExport(config.format);
  }, [config.format, startExport]);

  const formatExt =
    config.format === 'mjcf'
      ? '.xml'
      : config.format === 'xacro'
        ? '.urdf.xacro'
        : config.format === 'sdf'
          ? '.sdf'
          : config.format === 'usd'
            ? `.${config.usd.fileFormat}`
            : '.urdf';

  const formatLabel: Record<MeshExportFormat, string> = {
    mjcf: t.exportFormatMJCF,
    urdf: t.exportFormatURDF,
    xacro: t.exportFormatXacro,
    sdf: t.exportFormatSDF,
    usd: t.exportFormatUSD,
  };
  const compatibleTargets =
    config.format === 'project' ? [] : getExportFormatSupports(config.format);
  const rosVersionOptions: RosVersion[] = ['ros1', 'ros2'];
  const gazeboBackendOptions: GazeboBackend[] = ['classic', 'gz'];
  const getRosVersionLabel = (version: RosVersion) => {
    switch (version) {
      case 'ros1':
        return t.rosVersionRos1;
      case 'ros2':
        return t.rosVersionRos2;
    }
  };
  const getRosVersionDescription = (version: RosVersion) => {
    switch (version) {
      case 'ros1':
        return t.rosVersionDescRos1;
      case 'ros2':
        return t.rosVersionDescRos2;
    }
  };
  const getGazeboBackendLabel = (backend: GazeboBackend) => {
    switch (backend) {
      case 'classic':
        return t.gazeboBackendClassic;
      case 'gz':
        return t.gazeboBackendGz;
    }
  };
  const getGazeboBackendDescription = (backend: GazeboBackend) => {
    switch (backend) {
      case 'classic':
        return t.gazeboBackendDescClassic;
      case 'gz':
        return t.gazeboBackendDescGz;
    }
  };
  const xacroRosVersionDescription = getRosVersionDescription(config.xacro.rosVersion);
  const xacroGazeboBackendDescription =
    config.xacro.rosVersion === 'ros1'
      ? t.gazeboBackendDescClassic
      : getGazeboBackendDescription(config.xacro.gazeboBackend);
  const xacroHardwareInterfaceHint =
    config.xacro.rosVersion === 'ros1'
      ? t.hardwareInterfaceDescRos1
      : t.hardwareInterfaceDescRos2;

  return (
    <>
      <DraggableWindow
        window={windowState}
        onClose={onClose}
        title={
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-element-bg text-text-secondary border border-border-black">
              <Upload className="w-3.5 h-3.5" />
            </div>
            <span className={FLOATING_WINDOW_TITLE_CLASS}>{t.exportDialog}</span>
          </div>
        }
        className={`bg-panel-bg flex flex-col text-text-primary overflow-hidden ${FLOATING_WINDOW_RADIUS_CLASS} shadow-xl border border-border-black`}
        zIndex={exportDialogWindowLayer.zIndex}
        onActivate={exportDialogWindowLayer.onActivate}
        headerClassName={`${FLOATING_WINDOW_HEADER_HEIGHT_CLASS} border-b border-border-black flex items-center justify-between px-3 bg-element-bg shrink-0`}
        interactionClassName="select-none"
        showMinimizeButton={false}
        showMaximizeButton={false}
        showCloseButton={!isExporting}
        closeTitle={t.close}
        closeButtonClassName={`rounded p-1.5 ${CLOSE_BUTTON_DANGER_TERTIARY_CLASS}`}
        showResizeHandles={true}
      >
        {/* Scrollable body */}
        {isExporting ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            <ExportProgressView progress={progressState} t={t} />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
            {/* Format Selector */}
            <SectionLabel>{t.exportFormat}</SectionLabel>
            <div
              data-export-format-picker
              className={`grid gap-1 rounded-xl border border-border-black bg-segmented-bg p-1 ${formatGridClassName}`}
            >
              {EXPORT_FORMATS.map((fmt) => {
                const isDisabled = fmt === 'usd' && !canExportUsd;
                const isActive = config.format === fmt;
                return (
                  <button
                    key={fmt}
                    onClick={() => setFormat(fmt)}
                    disabled={isDisabled}
                    className={`relative flex min-w-0 items-center justify-center rounded-lg px-1.5 py-1.5 font-medium transition-all ${
                      isCompactFormatPicker ? 'gap-1 text-[10px]' : 'gap-1.5 text-[11px]'
                    } ${
                      isDisabled
                        ? 'opacity-40 cursor-not-allowed text-text-tertiary'
                        : isActive
                          ? 'bg-white dark:bg-segmented-active text-text-primary shadow-sm'
                          : 'text-text-secondary hover:text-text-primary hover:bg-element-hover'
                    }`}
                  >
                    {fmt === 'mjcf' && <FileCode className="w-3.5 h-3.5" />}
                    {fmt === 'urdf' && <Layers className="w-3.5 h-3.5" />}
                    {fmt === 'xacro' && <Braces className="w-3.5 h-3.5" />}
                    {fmt === 'sdf' && <Layers className="w-3.5 h-3.5" />}
                    {fmt === 'usd' && <Package className="w-3.5 h-3.5" />}
                    <span className="min-w-0 whitespace-nowrap leading-none">
                      {formatLabel[fmt]}
                    </span>
                    {isDisabled && (
                      <span className="absolute -top-1.5 -right-1 bg-element-hover text-text-tertiary text-[8px] px-1 py-0.5 rounded border border-border-black flex items-center gap-0.5">
                        <Lock className="w-2 h-2" />
                        {t.exportComingSoon}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Compatible simulators */}
            <div className="flex flex-wrap gap-1 pt-1 pb-0.5">
              {compatibleTargets.map((name) => (
                <span
                  key={name}
                  className="px-2 py-0.5 bg-element-bg border border-border-black rounded-full text-[10px] text-text-tertiary"
                >
                  {name}
                </span>
              ))}
            </div>

            {/* Divider */}
            <div className="h-px bg-border-black my-3" />

            {/* MJCF Options */}
            {config.format === 'mjcf' && (
              <>
                <SectionLabel>{t.exportOptionsSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row label={t.exportMeshdir} stacked={isStackedLayout}>
                    <TextField
                      value={config.mjcf.meshdir}
                      onChange={(v) => updateMjcf('meshdir', v)}
                      placeholder="meshes/"
                      fullWidth={isStackedLayout}
                    />
                  </Row>
                  <Row
                    label={t.exportFloatBase}
                    desc={t.exportFloatBaseDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.mjcf.addFloatBase}
                      onChange={(v) => updateMjcf('addFloatBase', v)}
                    />
                  </Row>
                  <Row
                    label={t.exportPreferSharedMeshReuse}
                    desc={t.exportPreferSharedMeshReuseDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.mjcf.preferSharedMeshReuse}
                      onChange={(v) => updateMjcf('preferSharedMeshReuse', v)}
                    />
                  </Row>
                  <Row label={t.exportIncludeActuators} stacked={isStackedLayout}>
                    <Toggle
                      value={config.mjcf.includeActuators}
                      onChange={(v) => updateMjcf('includeActuators', v)}
                    />
                  </Row>
                  {config.mjcf.includeActuators && (
                    <Row label={t.exportActuatorType} stacked={isStackedLayout}>
                      <SelectField
                        value={config.mjcf.actuatorType}
                        options={actuatorTypeOptions}
                        onChange={(v) => updateMjcf('actuatorType', v as MjcfActuatorType)}
                        fullWidth={isStackedLayout}
                      />
                    </Row>
                  )}
                </div>

                <SectionLabel>{t.exportOutputSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row
                    label={t.exportIncludeSkeleton}
                    desc={t.exportIncludeSkeletonDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle value={config.includeSkeleton} onChange={updateIncludeSkeleton} />
                  </Row>
                  <Row label={t.exportIncludeMeshes} stacked={isStackedLayout}>
                    <Toggle
                      value={config.mjcf.includeMeshes}
                      onChange={(v) => updateMjcf('includeMeshes', v)}
                    />
                  </Row>
                  {config.mjcf.includeMeshes && (
                    <STLQualitySelector
                      compressSTL={config.mjcf.compressSTL}
                      stlQuality={config.mjcf.stlQuality}
                      mode={qualityModes.mjcf}
                      t={t}
                      onCompressChange={(v) => updateMjcf('compressSTL', v)}
                      onQualityChange={(v) => updateMjcf('stlQuality', v)}
                      onModeChange={(mode) => updateQualityMode('mjcf', mode)}
                    />
                  )}
                </div>
              </>
            )}

            {/* URDF Options */}
            {config.format === 'urdf' && (
              <>
                <SectionLabel>{t.exportOptionsSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row
                    label={t.exportIncludeExtended}
                    desc={t.exportIncludeExtendedDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.urdf.includeExtended}
                      onChange={(v) => updateUrdf('includeExtended', v)}
                    />
                  </Row>
                  <Row
                    label={t.exportIncludeBOM}
                    desc={t.exportIncludeBOMDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.urdf.includeBOM}
                      onChange={(v) => updateUrdf('includeBOM', v)}
                    />
                  </Row>
                  <Row
                    label={t.exportRelativePaths}
                    desc={t.exportRelativePathsDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.urdf.useRelativePaths}
                      onChange={(v) => updateUrdf('useRelativePaths', v)}
                    />
                  </Row>
                  {!config.urdf.includeExtended && (
                    <Row
                      label={t.exportPreferSourceVisualMeshes}
                      desc={t.exportPreferSourceVisualMeshesDesc}
                      stacked={isStackedLayout}
                    >
                      <Toggle
                        value={config.urdf.preferSourceVisualMeshes}
                        onChange={(v) => updateUrdf('preferSourceVisualMeshes', v)}
                      />
                    </Row>
                  )}
                </div>
                <SectionLabel>{t.exportOutputSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row
                    label={t.exportIncludeSkeleton}
                    desc={t.exportIncludeSkeletonDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle value={config.includeSkeleton} onChange={updateIncludeSkeleton} />
                  </Row>
                  <Row label={t.exportIncludeMeshes} stacked={isStackedLayout}>
                    <Toggle
                      value={config.urdf.includeMeshes}
                      onChange={(v) => updateUrdf('includeMeshes', v)}
                    />
                  </Row>
                  {config.urdf.includeMeshes && (
                    <STLQualitySelector
                      compressSTL={config.urdf.compressSTL}
                      stlQuality={config.urdf.stlQuality}
                      mode={qualityModes.urdf}
                      t={t}
                      onCompressChange={(v) => updateUrdf('compressSTL', v)}
                      onQualityChange={(v) => updateUrdf('stlQuality', v)}
                      onModeChange={(mode) => updateQualityMode('urdf', mode)}
                    />
                  )}
                </div>
              </>
            )}

            {/* Xacro Options */}
            {config.format === 'xacro' && (
              <>
                <SectionLabel>{t.exportOptionsSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row
                    label={t.includeGazeboControl}
                    desc={t.includeGazeboControlDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.xacro.includeGazeboControl}
                      onChange={(v) => updateXacro('includeGazeboControl', v)}
                      ariaLabel={t.includeGazeboControl}
                    />
                  </Row>
                  {config.xacro.includeGazeboControl && (
                    <>
                      <Row
                        label={t.rosVersion}
                        hint={`${t.exportXacroStaticHint} ${xacroRosVersionDescription} ${xacroGazeboBackendDescription}`}
                        stacked={isCompactLayout}
                      >
                        <div
                          data-xacro-ros-version-picker
                          className={`grid gap-1.5 rounded-xl border border-border-black bg-segmented-bg p-1.5 ${
                            isCompactLayout ? 'grid-cols-1 w-full' : 'min-w-[220px] grid-cols-2'
                          }`}
                        >
                          {rosVersionOptions.map((v) => {
                            const isActive = config.xacro.rosVersion === v;
                            const label = getRosVersionLabel(v);
                            const description = getRosVersionDescription(v);

                            return (
                              <button
                                key={v}
                                type="button"
                                onClick={() => updateXacroRosVersion(v)}
                                title={description}
                                aria-label={`${label}. ${description}`}
                                aria-pressed={isActive}
                                className={`flex min-h-[2.5rem] w-full items-center rounded-lg border px-2.5 py-2 text-left text-[10px] font-semibold leading-tight whitespace-normal break-words transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                                  isActive
                                    ? 'border-system-blue/30 bg-system-blue/10 text-system-blue shadow-sm'
                                    : 'border-transparent text-text-secondary hover:border-system-blue/20 hover:bg-element-hover hover:text-text-primary'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </Row>
                      {config.xacro.rosVersion === 'ros2' && (
                        <Row
                          label={t.gazeboBackend}
                          hint={xacroGazeboBackendDescription}
                          stacked={isCompactLayout}
                        >
                          <div
                            data-xacro-gazebo-backend-picker
                            className={`grid gap-1.5 rounded-xl border border-border-black bg-segmented-bg p-1.5 ${
                              isCompactLayout ? 'grid-cols-1 w-full' : 'min-w-[260px] grid-cols-2'
                            }`}
                          >
                            {gazeboBackendOptions.map((backend) => {
                              const isActive = config.xacro.gazeboBackend === backend;
                              const label = getGazeboBackendLabel(backend);
                              const description = getGazeboBackendDescription(backend);

                              return (
                                <button
                                  key={backend}
                                  type="button"
                                  onClick={() => updateXacro('gazeboBackend', backend)}
                                  title={description}
                                  aria-label={`${label}. ${description}`}
                                  aria-pressed={isActive}
                                  className={`flex min-h-[2.5rem] w-full items-center rounded-lg border px-2.5 py-2 text-left text-[10px] font-semibold leading-tight whitespace-normal break-words transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                                    isActive
                                      ? 'border-system-blue/30 bg-system-blue/10 text-system-blue shadow-sm'
                                      : 'border-transparent text-text-secondary hover:border-system-blue/20 hover:bg-element-hover hover:text-text-primary'
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </Row>
                      )}
                      <Row
                        label={t.hardwareInterface}
                        hint={xacroHardwareInterfaceHint}
                        stacked={isStackedLayout}
                      >
                        <SelectField
                          value={config.xacro.rosHardwareInterface}
                          title={xacroHardwareInterfaceHint}
                          options={[
                            { value: 'effort', label: t.hardwareInterfaceEffort },
                            { value: 'position', label: t.hardwareInterfacePosition },
                            { value: 'velocity', label: t.hardwareInterfaceVelocity },
                          ]}
                          onChange={(v) =>
                            updateXacro('rosHardwareInterface', v as RosHwInterface)
                          }
                          fullWidth={isStackedLayout}
                        />
                      </Row>
                    </>
                  )}
                  <Row
                    label={t.exportRelativePaths}
                    desc={t.exportRelativePathsDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.xacro.useRelativePaths}
                      onChange={(v) => updateXacro('useRelativePaths', v)}
                    />
                  </Row>
                </div>
                <SectionLabel>{t.exportOutputSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row
                    label={t.exportIncludeSkeleton}
                    desc={t.exportIncludeSkeletonDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle value={config.includeSkeleton} onChange={updateIncludeSkeleton} />
                  </Row>
                  <Row label={t.exportIncludeMeshes} stacked={isStackedLayout}>
                    <Toggle
                      value={config.xacro.includeMeshes}
                      onChange={(v) => updateXacro('includeMeshes', v)}
                    />
                  </Row>
                  {config.xacro.includeMeshes && (
                    <STLQualitySelector
                      compressSTL={config.xacro.compressSTL}
                      stlQuality={config.xacro.stlQuality}
                      mode={qualityModes.xacro}
                      t={t}
                      onCompressChange={(v) => updateXacro('compressSTL', v)}
                      onQualityChange={(v) => updateXacro('stlQuality', v)}
                      onModeChange={(mode) => updateQualityMode('xacro', mode)}
                    />
                  )}
                </div>
              </>
            )}

            {config.format === 'sdf' && (
              <>
                <SectionLabel>{t.exportOutputSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row
                    label={t.exportIncludeSkeleton}
                    desc={t.exportIncludeSkeletonDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle value={config.includeSkeleton} onChange={updateIncludeSkeleton} />
                  </Row>
                  <Row label={t.exportIncludeMeshes} stacked={isStackedLayout}>
                    <Toggle
                      value={config.sdf.includeMeshes}
                      onChange={(v) => updateSdf('includeMeshes', v)}
                    />
                  </Row>
                  {config.sdf.includeMeshes && (
                    <STLQualitySelector
                      compressSTL={config.sdf.compressSTL}
                      stlQuality={config.sdf.stlQuality}
                      mode={qualityModes.sdf}
                      t={t}
                      onCompressChange={(v) => updateSdf('compressSTL', v)}
                      onQualityChange={(v) => updateSdf('stlQuality', v)}
                      onModeChange={(mode) => updateQualityMode('sdf', mode)}
                    />
                  )}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-text-tertiary">
                  {t.exportSdfTextureOverrideNotice}
                </p>
              </>
            )}

            {config.format === 'usd' && (
              <>
                <SectionLabel>{t.exportOptionsSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row label={t.exportUsdFileFormat} stacked={isStackedLayout}>
                    <div data-usd-file-format-picker className={isStackedLayout ? 'w-full' : ''}>
                      <SegmentedChoiceField
                        value={config.usd.fileFormat}
                        options={[
                          { value: 'usd', label: t.exportUsdFileFormatUsd },
                          { value: 'usda', label: t.exportUsdFileFormatUsda },
                        ]}
                        onChange={(value) => updateUsd('fileFormat', value)}
                      />
                    </div>
                  </Row>
                  <STLQualitySelector
                    compressSTL={config.usd.compressMeshes}
                    stlQuality={config.usd.meshQuality}
                    mode={qualityModes.usd}
                    t={t}
                    label={t.exportCompressMeshes}
                    description={null}
                    onCompressChange={(v) => updateUsd('compressMeshes', v)}
                    onQualityChange={(v) => updateUsd('meshQuality', v)}
                    onModeChange={(mode) => updateQualityMode('usd', mode)}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-border-black bg-element-bg">
          <div
            className={`flex gap-3 ${isCompactLayout ? 'flex-col items-stretch' : 'items-center'}`}
          >
            {isExporting ? (
              <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-system-blue" />
                <span className="truncate">
                  {t.exportProgressStepCounter
                    .replace('{current}', String(progressState.currentStep))
                    .replace('{total}', String(progressState.totalSteps))}
                </span>
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-text-tertiary">
                {config.format === 'mjcf' ? (
                  <FileCode className="w-4 h-4" />
                ) : config.format === 'xacro' ? (
                  <Braces className="w-4 h-4" />
                ) : config.format === 'sdf' ? (
                  <Layers className="w-4 h-4" />
                ) : config.format === 'usd' ? (
                  <Package className="w-4 h-4" />
                ) : (
                  <Layers className="w-4 h-4" />
                )}
                <span className="font-mono break-all">
                  {config.format === 'usd'
                    ? `${formatExt} layered package → .zip`
                    : `${formatExt} + meshes → .zip`}
                </span>
              </div>
            )}
            {!isCompactLayout && <div className="flex-1" />}
            <button
              onClick={handleExportClick}
              disabled={isExporting}
              className={`flex items-center justify-center gap-2 rounded-lg bg-system-blue-solid px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-system-blue disabled:cursor-not-allowed disabled:opacity-50 ${
                isCompactLayout ? 'w-full' : ''
              }`}
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {isExporting ? t.exporting : t.exportDoExport}
            </button>
          </div>
        </div>
      </DraggableWindow>
    </>
  );
};
