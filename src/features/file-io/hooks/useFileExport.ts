/**
 * useFileExport Hook
 * Handle export operations for robot package (URDF, BOM, MuJoCo, meshes)
 */

import { useCallback } from 'react';
import JSZip from 'jszip';
import { generateURDF, generateMujocoXML } from '@/core/parsers';
import { useAssetsStore, useUIStore, useRobotStore } from '@/store';
import { GeometryType } from '@/types';
import type { RobotState } from '@/types';
import type { ExportOptions } from '../types';
import {
  generateBOM,
  collectReferencedMeshes,
  fetchMeshBlobs,
  downloadBlob,
} from '../utils';

interface UseFileExportReturn {
  handleExport: (options?: ExportOptions) => Promise<void>;
}

export function useFileExport(): UseFileExportReturn {
  const lang = useUIStore((s) => s.language);
  const assets = useAssetsStore((s) => s.assets);

  // Get robot state - combine store data with selection
  const robotName = useRobotStore((s) => s.name);
  const robotLinks = useRobotStore((s) => s.links);
  const robotJoints = useRobotStore((s) => s.joints);
  const rootLinkId = useRobotStore((s) => s.rootLinkId);

  const handleExport = useCallback(async (options: ExportOptions = {}) => {
    const {
      includeExtended = true,
      includeBOM = true,
      includeMuJoCo = true,
      includeMeshes = true,
    } = options;

    // Build robot state object for generators
    const robot: RobotState = {
      name: robotName,
      links: robotLinks,
      joints: robotJoints,
      rootLinkId,
      selection: { type: null, id: null },
    };

    const zip = new JSZip();
    const urdfFolder = zip.folder('urdf');
    const meshFolder = zip.folder('meshes');
    const hardwareFolder = zip.folder('hardware');
    const mujocoFolder = zip.folder('mujoco');

    // 1. Generate Standard URDF
    const xml = generateURDF(robot, false);
    urdfFolder?.file(`${robot.name}.urdf`, xml);

    // 2. Generate Extended URDF (with hardware info)
    if (includeExtended) {
      const extendedXml = generateURDF(robot, true);
      urdfFolder?.file(`${robot.name}_extended.urdf`, extendedXml);
    }

    // 3. Generate BOM
    if (includeBOM) {
      const bomCsv = generateBOM(robot, lang);
      hardwareFolder?.file('bom_list.csv', bomCsv);
    }

    // 4. Generate MuJoCo XML
    if (includeMuJoCo) {
      const mujocoXml = generateMujocoXML(robot);
      mujocoFolder?.file(`${robot.name}.xml`, mujocoXml);
    }

    // 5. Add Meshes
    if (includeMeshes) {
      const referencedFiles = collectReferencedMeshes(robot.links, GeometryType.MESH);
      const meshBlobs = await fetchMeshBlobs(referencedFiles, assets);

      meshBlobs.forEach(({ name, blob }) => {
        meshFolder?.file(name, blob);
      });
    }

    // Generate and download ZIP
    const content = await zip.generateAsync({ type: 'blob' });
    downloadBlob(content, `${robot.name}_package.zip`);
  }, [robotName, robotLinks, robotJoints, rootLinkId, assets, lang]);

  return {
    handleExport,
  };
}
