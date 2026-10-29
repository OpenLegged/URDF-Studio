import { GeometryType, type UrdfVisual } from '@/types';
import {
  InlineInputGroup,
  PROPERTY_EDITOR_FIELD_LABEL_CLASS,
  PROPERTY_EDITOR_HELPER_TEXT_CLASS,
  PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS,
  ReadonlyValueField,
} from './FormControls';
import { InlineDimensionInputRow } from './InlineDimensionInputRow';
import type { GeometryEditorTranslations, GeometryUpdate } from './GeometryEditor.types';
import {
  POSITIVE_GEOMETRY_VALUE_MIN,
  stripAxisSuffix,
} from './geometryEditorConstants';

interface GeometryDimensionsSectionProps {
  geometry: UrdfVisual;
  onUpdate: (update: GeometryUpdate) => void;
  t: GeometryEditorTranslations;
}

export const GeometryDimensionsSection = ({
  geometry,
  onUpdate,
  t,
}: GeometryDimensionsSectionProps) => {
  const geometryAssetReference = geometry.assetRef?.trim() || geometry.meshPath?.trim() || '';
  const hfieldAssetMetadata =
    geometry.type === GeometryType.HFIELD ? geometry.mjcfHfield : undefined;
  const capsuleDiameter = 2 * (geometry.dimensions?.x || 0.05);

  return (
    <>
      {geometry.type === GeometryType.MESH && (
        <div className="mb-1">
          <label className={`${PROPERTY_EDITOR_FIELD_LABEL_CLASS} mb-0.5`}>{t.meshScale}</label>
          <InlineDimensionInputRow
            columns={3}
            showStepper={false}
            fields={[
              {
                label: 'X',
                value: geometry.dimensions?.x ?? 1,
                onChange: (v: number) =>
                  onUpdate({ dimensions: { ...geometry.dimensions, x: v } }),
              },
              {
                label: 'Y',
                value: geometry.dimensions?.y ?? 1,
                onChange: (v: number) =>
                  onUpdate({ dimensions: { ...geometry.dimensions, y: v } }),
              },
              {
                label: 'Z',
                value: geometry.dimensions?.z ?? 1,
                onChange: (v: number) =>
                  onUpdate({ dimensions: { ...geometry.dimensions, z: v } }),
              },
            ]}
          />
        </div>
      )}

      {geometry.type === GeometryType.BOX && (
        <InlineDimensionInputRow
          columns={3}
          fields={[
            {
              label: stripAxisSuffix(t.width || 'Width'),
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geometry.dimensions?.x || 0.1,
              onChange: (v) => onUpdate({ dimensions: { ...geometry.dimensions, x: v } }),
            },
            {
              label: stripAxisSuffix(t.height || 'Height'),
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geometry.dimensions?.z || 0.1,
              onChange: (v) => onUpdate({ dimensions: { ...geometry.dimensions, z: v } }),
            },
            {
              label: stripAxisSuffix(t.depth || 'Depth'),
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geometry.dimensions?.y || 0.1,
              onChange: (v) => onUpdate({ dimensions: { ...geometry.dimensions, y: v } }),
            },
          ]}
          labelClassName={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}
          labelWidthClassName="whitespace-nowrap"
        />
      )}

      {geometry.type === GeometryType.PLANE && (
        <InlineDimensionInputRow
          columns={2}
          fields={[
            {
              label: stripAxisSuffix(t.width || 'Width'),
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geometry.dimensions?.x || 1,
              onChange: (v) => onUpdate({ dimensions: { ...geometry.dimensions, x: v } }),
            },
            {
              label: stripAxisSuffix(t.depth || 'Depth'),
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geometry.dimensions?.y || 1,
              onChange: (v) => onUpdate({ dimensions: { ...geometry.dimensions, y: v } }),
            },
          ]}
          labelClassName={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}
          labelWidthClassName="whitespace-nowrap"
        />
      )}

      {geometry.type === GeometryType.SPHERE && (
        <InlineDimensionInputRow
          columns={1}
          fields={[
            {
              label: t.radius || 'Radius',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geometry.dimensions?.x || 0.1,
              onChange: (v) => onUpdate({ dimensions: { x: v, y: v, z: v } }),
            },
          ]}
          labelClassName={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}
          labelWidthClassName="whitespace-nowrap"
        />
      )}

      {geometry.type === GeometryType.ELLIPSOID && (
        <InlineDimensionInputRow
          columns={3}
          fields={[
            {
              label: t.radiusX || 'Radius X',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geometry.dimensions?.x || 0.1,
              onChange: (v) => onUpdate({ dimensions: { ...geometry.dimensions, x: v } }),
            },
            {
              label: t.radiusY || 'Radius Y',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geometry.dimensions?.y || geometry.dimensions?.x || 0.1,
              onChange: (v) => onUpdate({ dimensions: { ...geometry.dimensions, y: v } }),
            },
            {
              label: t.radiusZ || 'Radius Z',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geometry.dimensions?.z || geometry.dimensions?.x || 0.1,
              onChange: (v) => onUpdate({ dimensions: { ...geometry.dimensions, z: v } }),
            },
          ]}
          labelClassName={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}
          labelWidthClassName="whitespace-nowrap"
        />
      )}

      {geometry.type === GeometryType.CYLINDER && (
        <InlineDimensionInputRow
          columns={2}
          fields={[
            {
              label: t.radius || 'Radius',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geometry.dimensions?.x || 0.05,
              onChange: (v) =>
                onUpdate({ dimensions: { ...geometry.dimensions, x: v, z: v } }),
            },
            {
              label: t.height || 'Height',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geometry.dimensions?.y || 0.5,
              onChange: (v) => onUpdate({ dimensions: { ...geometry.dimensions, y: v } }),
            },
          ]}
          labelClassName={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}
          labelWidthClassName="whitespace-nowrap"
        />
      )}

      {geometry.type === GeometryType.CAPSULE && (
        <InlineDimensionInputRow
          columns={2}
          fields={[
            {
              label: t.radius || 'Radius',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geometry.dimensions?.x || 0.05,
              onChange: (v) =>
                onUpdate({ dimensions: { ...geometry.dimensions, x: v, z: v } }),
            },
            {
              label: t.totalLength || 'Total Length',
              min: capsuleDiameter,
              value: (geometry.dimensions?.y ?? 0.5) + capsuleDiameter,
              onChange: (v) => onUpdate({
                dimensions: { ...geometry.dimensions, y: Math.max(v - capsuleDiameter, 0) },
              }),
            },
          ]}
          labelClassName={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}
          labelWidthClassName="whitespace-nowrap"
        />
      )}

      {(geometry.type === GeometryType.HFIELD || geometry.type === GeometryType.SDF) && (
        <div className="space-y-2">
          {geometryAssetReference ? (
            <InlineInputGroup label={t.assetReference} labelWidthClassName="w-16">
              <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                {geometryAssetReference}
              </ReadonlyValueField>
            </InlineInputGroup>
          ) : null}
          {hfieldAssetMetadata?.file ? (
            <InlineInputGroup label={t.file} labelWidthClassName="w-16">
              <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                {hfieldAssetMetadata.file}
              </ReadonlyValueField>
            </InlineInputGroup>
          ) : null}
          {hfieldAssetMetadata?.contentType ? (
            <InlineInputGroup label={t.contentType} labelWidthClassName="w-16">
              <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                {hfieldAssetMetadata.contentType}
              </ReadonlyValueField>
            </InlineInputGroup>
          ) : null}
          {hfieldAssetMetadata?.size ? (
            <InlineInputGroup label={t.size} labelWidthClassName="w-16">
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                  {`${t.width}: ${hfieldAssetMetadata.size.radiusX * 2}`}
                </ReadonlyValueField>
                <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                  {`${t.depth}: ${hfieldAssetMetadata.size.radiusY * 2}`}
                </ReadonlyValueField>
                <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                  {`${t.height}: ${hfieldAssetMetadata.size.elevationZ}`}
                </ReadonlyValueField>
                <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                  {`${t.baseHeight}: ${hfieldAssetMetadata.size.baseZ}`}
                </ReadonlyValueField>
              </div>
            </InlineInputGroup>
          ) : null}
          {Number.isFinite(hfieldAssetMetadata?.nrow) ||
          Number.isFinite(hfieldAssetMetadata?.ncol) ? (
            <InlineInputGroup label={t.size} labelWidthClassName="w-16">
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                  {`${t.rows}: ${hfieldAssetMetadata?.nrow ?? 0}`}
                </ReadonlyValueField>
                <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                  {`${t.cols}: ${hfieldAssetMetadata?.ncol ?? 0}`}
                </ReadonlyValueField>
              </div>
            </InlineInputGroup>
          ) : null}
          <div className={PROPERTY_EDITOR_HELPER_TEXT_CLASS}>{t.mjcfLimitedGeometryHint}</div>
        </div>
      )}
    </>
  );
};
