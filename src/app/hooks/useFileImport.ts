/**
 * File Import Hook
 * Handles importing URDF, MJCF, USD, Xacro files and ZIP packages
 */
import { useCallback } from 'react';
import JSZip from 'jszip';
import type { RobotFile, MotorSpec, RobotState } from '@/types';
import { parseURDF, parseMJCF, isMJCF, parseUSDA, isUSDA, parseXacro, isXacro } from '@/core/parsers';
import { DEFAULT_MOTOR_LIBRARY } from '@/features/hardware-config';
import { useAssetsStore, useRobotStore, useUIStore } from '@/store';
import type { Language } from '@/shared/i18n';

interface UseFileImportOptions {
  onLoadRobot?: (file: RobotFile) => void;
  onShowToast?: (message: string, type?: 'info' | 'success') => void;
}

export function useFileImport(options: UseFileImportOptions = {}) {
  const { onLoadRobot, onShowToast } = options;

  const lang = useUIStore((state) => state.lang);
  const setAppMode = useUIStore((state) => state.setAppMode);

  // Assets store
  const setAssets = useAssetsStore((state) => state.setAssets);
  const setAvailableFiles = useAssetsStore((state) => state.setAvailableFiles);
  const setMotorLibrary = useAssetsStore((state) => state.setMotorLibrary);
  const assets = useAssetsStore((state) => state.assets);

  // Robot store
  const resetRobot = useRobotStore((state) => state.reset);

  // Detect file format from content
  const detectFormat = useCallback((content: string, filename: string): 'urdf' | 'mjcf' | 'usd' | 'xacro' | null => {
    const lowerName = filename.toLowerCase();

    // Check by extension first
    if (lowerName.endsWith('.xacro') || lowerName.endsWith('.urdf.xacro')) return 'xacro';
    if (lowerName.endsWith('.urdf')) return 'urdf';
    if (lowerName.endsWith('.usda') || lowerName.endsWith('.usdc') || lowerName.endsWith('.usd')) return 'usd';

    // For XML files, check content
    if (lowerName.endsWith('.xml')) {
      if (isMJCF(content)) return 'mjcf';
      if (isXacro(content)) return 'xacro';
      if (content.includes('<robot')) return 'urdf';
    }

    // Try content-based detection
    if (isUSDA(content)) return 'usd';
    if (isMJCF(content)) return 'mjcf';
    if (isXacro(content)) return 'xacro';
    if (content.includes('<robot')) return 'urdf';

    return null;
  }, []);

  // Load a robot file
  const loadRobot = useCallback((file: RobotFile, availableFiles: RobotFile[] = [], currentAssets: Record<string, string> = {}) => {
    let newState: RobotState | null = null;

    switch (file.format) {
      case 'urdf':
        newState = parseURDF(file.content);
        break;
      case 'mjcf':
        newState = parseMJCF(file.content);
        break;
      case 'usd':
        newState = parseUSDA(file.content);
        break;
      case 'xacro':
        // Build file map for xacro includes
        const fileMap: { [path: string]: string } = {};
        availableFiles.forEach(f => {
          fileMap[f.name] = f.content;
        });
        Object.entries(currentAssets).forEach(([path, content]) => {
          if (typeof content === 'string') {
            fileMap[path] = content;
          }
        });
        const pathParts = file.name.split('/');
        pathParts.pop();
        const basePath = pathParts.join('/');
        newState = parseXacro(file.content, {}, fileMap, basePath);
        break;
    }

    if (newState && onLoadRobot) {
      onLoadRobot(file);
    }

    return newState;
  }, [onLoadRobot]);

  // Handle file import
  const handleImport = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Show privacy toast
    if (onShowToast) {
      onShowToast(
        lang === 'zh'
          ? "提示：所有数据仅在您的本地浏览器中处理，不会上传到云端服务器，您的数据是安全的。"
          : "Note: All data is processed locally in your browser and will NOT be uploaded to any cloud server. Your data is safe.",
        'success'
      );
    }

    try {
      const newRobotFiles: RobotFile[] = [];
      const assetFiles: { name: string; blob: Blob }[] = [];
      const libraryFiles: { path: string; content: string }[] = [];

      // Mode 1: Single ZIP file
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        const zip = await JSZip.loadAsync(files[0]);

        const promises: Promise<void>[] = [];
        zip.forEach((relativePath, fileEntry) => {
          if (fileEntry.dir) return;

          // Skip hidden files/folders
          const pathParts = relativePath.split('/');
          if (pathParts.some(part => part.startsWith('.'))) return;

          const lowerPath = relativePath.toLowerCase();
          const p = (async () => {
            if (lowerPath.endsWith('.urdf') || lowerPath.endsWith('.xml') ||
                lowerPath.endsWith('.mjcf') || lowerPath.endsWith('.usda') ||
                lowerPath.endsWith('.usd') || lowerPath.endsWith('.xacro')) {
              const content = await fileEntry.async("string");
              const format = detectFormat(content, relativePath);
              if (format) {
                newRobotFiles.push({ name: relativePath, content, format });
              }
            } else if (lowerPath.includes('motor library') && lowerPath.endsWith('.txt')) {
              const content = await fileEntry.async("string");
              libraryFiles.push({ path: relativePath, content });
            } else {
              const blob = await fileEntry.async("blob");
              assetFiles.push({ name: relativePath, blob });
            }
          })();
          promises.push(p);
        });
        await Promise.all(promises);

      } else {
        // Mode 2: Multiple Files
        const fileList = Array.from(files);

        const promises = fileList.map(async f => {
          const lowerName = f.name.toLowerCase();
          const path = f.webkitRelativePath || f.name;

          // Skip hidden files/folders
          const pathParts = path.split('/');
          if (pathParts.some(part => part.startsWith('.'))) return;

          if (lowerName.endsWith('.urdf') || lowerName.endsWith('.xml') ||
              lowerName.endsWith('.mjcf') || lowerName.endsWith('.usda') ||
              lowerName.endsWith('.usd') || lowerName.endsWith('.xacro')) {
            const content = await f.text();
            const format = detectFormat(content, f.name);
            if (format) {
              newRobotFiles.push({ name: path, content, format });
            }
          } else if (path.includes('motor library') && lowerName.endsWith('.txt')) {
            const content = await f.text();
            libraryFiles.push({ path: path, content });
          } else {
            assetFiles.push({ name: path, blob: f });
          }
        });
        await Promise.all(promises);
      }

      // 1. Process Motor Library
      if (libraryFiles.length > 0) {
        const newLibrary: Record<string, MotorSpec[]> = { ...DEFAULT_MOTOR_LIBRARY };
        libraryFiles.forEach(f => {
          try {
            const parts = f.path.split('/');
            if (parts.length >= 2) {
              const brand = parts[parts.length - 2];
              const spec = JSON.parse(f.content) as MotorSpec;
              if (!newLibrary[brand]) newLibrary[brand] = [];
              if (!newLibrary[brand].some(m => m.name === spec.name)) {
                newLibrary[brand].push(spec);
              }
            }
          } catch (err) {
            console.warn("Failed to parse motor spec", f.path);
          }
        });
        setMotorLibrary(newLibrary);
      }

      // 2. Load Assets
      const newAssets: Record<string, string> = {};
      const assetPromises = assetFiles.map(async f => {
        const ext = f.name.split('.').pop()?.toLowerCase();
        if (['stl', 'obj', 'dae', 'png', 'jpg', 'jpeg', 'tga', 'bmp', 'tiff', 'tif', 'webp'].includes(ext || '')) {
          const url = URL.createObjectURL(f.blob);
          newAssets[f.name] = url;
          const filename = f.name.split('/').pop()!;
          newAssets[filename] = url;
          if (f.name.includes('/meshes/')) {
            newAssets['/meshes/' + filename] = url;
          }
          // Store various path patterns
          const parts = f.name.split('/');
          for (let i = 0; i < parts.length; i++) {
            const subPath = parts.slice(i).join('/');
            if (!newAssets[subPath]) newAssets[subPath] = url;
            if (!newAssets['/' + subPath]) newAssets['/' + subPath] = url;
          }
        }
      });
      await Promise.all(assetPromises);

      // Cleanup old assets
      Object.values(assets).forEach(url => URL.revokeObjectURL(url));
      setAssets(newAssets);

      // 3. Set Available Files
      setAvailableFiles(newRobotFiles);

      // 4. Load first robot if available
      if (newRobotFiles.length > 0) {
        const firstFile = newRobotFiles[0];
        const robotState = loadRobot(firstFile, newRobotFiles, newAssets);
        if (robotState && onLoadRobot) {
          onLoadRobot(firstFile);
        }
        setAppMode('detail');
      } else if (libraryFiles.length > 0) {
        alert(lang === 'zh' ? "库导入成功！" : "Library imported successfully!");
      } else if (assetFiles.length === 0) {
        alert(lang === 'zh' ? "未找到 URDF/MJCF/USD 文件。" : "No URDF/MJCF/USD file found.");
      }

    } catch (error: any) {
      console.error("Import failed:", error);
      alert(lang === 'zh' ? "导入失败。请检查文件是否有效。" : "Failed to import. Please check if the file(s) are valid.");
    }
  }, [lang, assets, detectFormat, loadRobot, onLoadRobot, onShowToast, setAssets, setAvailableFiles, setMotorLibrary, setAppMode]);

  return {
    handleImport,
    loadRobot,
    detectFormat,
  };
}

export default useFileImport;
