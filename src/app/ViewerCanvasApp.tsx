/**
 * ViewerCanvasApp — canvas-only embed entry for external hosts.
 *
 * Rendered when the URL carries `?viewerCanvas=1`. It shows nothing but the
 * editor's middle 3D canvas (RobotCanvas) filling the viewport, and receives
 * the robot through a small postMessage protocol:
 *
 *   child  → parent: {type: 'robot-viewer-ready'}
 *   parent → child:  {type: 'robot-viewer-load',
 *                     files: [{blob: Blob, path: string}, …],
 *                     theme?: 'light' | 'dark'}
 *   child  → parent: {type: 'robot-viewer-loaded', ok: true, name?}
 *                    | {type: 'robot-viewer-loaded', ok: false, error}
 *
 * One of the files must be a `.urdf`; every other file is exposed to the
 * canvas as an asset under its relative path (mesh references resolve
 * against those paths). All data is supplied by the embedding parent, so no
 * origin restriction is needed for the load direction; replies are sent to
 * the origin of the accepted message.
 */
import { useEffect, useState } from 'react';
import { RobotCanvas, type RobotCanvasSource } from '@/lib';
import type { Theme } from '@/types';

interface ViewerJob {
  source: RobotCanvasSource;
  assets: Record<string, string>;
  theme: Theme;
  name: string;
}

interface ViewerFile {
  blob: Blob;
  path: string;
}

function isViewerFile(value: unknown): value is ViewerFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {blob?: unknown; path?: unknown};
  return candidate.blob instanceof Blob
    && typeof candidate.path === 'string'
    && candidate.path.length > 0;
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

export function ViewerCanvasApp() {
  const [job, setJob] = useState<ViewerJob | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (window.parent === window) return;
    const receive = async (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || typeof message !== 'object' || (message as {type?: unknown}).type !== 'robot-viewer-load') return;
      const reply = (payload: Record<string, unknown>) =>
        window.parent.postMessage({type: 'robot-viewer-loaded', ...payload}, event.origin);
      try {
        const raw = (message as {files?: unknown}).files;
        if (!Array.isArray(raw) || !raw.length || !raw.every(isViewerFile)) {
          throw new Error('robot-viewer-load expects a non-empty files: [{blob, path}] array');
        }
        const files = raw as ViewerFile[];
        const urdf = files.find(file => /\.urdf$/i.test(file.path));
        if (!urdf) throw new Error('no .urdf file in the viewer payload');
        const content = await urdf.blob.text();
        if (!content.trim()) throw new Error('the .urdf file is empty');
        const assets: Record<string, string> = {};
        for (const file of files) {
          if (file === urdf) continue;
          assets[file.path] = URL.createObjectURL(file.blob);
        }
        const theme = (message as {theme?: unknown}).theme === 'dark' ? 'dark' : 'light';
        setJob({source: {format: 'urdf', content, sourceFilePath: urdf.path}, assets, theme, name: basename(urdf.path)});
        reply({ok: true, name: basename(urdf.path)});
      } catch (failure) {
        const text = failure instanceof Error ? failure.message : String(failure);
        setError(text);
        reply({ok: false, error: text});
      }
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({type: 'robot-viewer-ready'}, '*');
    return () => window.removeEventListener('message', receive);
  }, []);

  if (error) {
    return (
      <div style={{position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', color: '#f87171', fontSize: 13}}>
        URDF viewer: {error}
      </div>
    );
  }
  if (!job) return <div style={{position: 'fixed', inset: 0}} />;
  return (
    <div style={{position: 'fixed', inset: 0, overflow: 'hidden'}}>
      <RobotCanvas
        source={job.source}
        assets={job.assets}
        theme={job.theme}
        orbitEnabled
        enableJointInteraction
        allowUrdfXmlFallback
        style={{width: '100%', height: '100%'}}
      />
    </div>
  );
}
