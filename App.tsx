
import React, { useState, useRef } from 'react';
import { TreeEditor } from './components/TreeEditor';
import { PropertyEditor } from './components/PropertyEditor';
import { Visualizer } from './components/Visualizer';
import { URDFViewer } from './components/URDFViewer';
import { RobotState, DEFAULT_LINK, DEFAULT_JOINT, UrdfLink, UrdfJoint, GeometryType, MotorSpec } from './types';
import { generateURDF } from './services/urdfGenerator';
import { generateMujocoXML } from './services/mujocoGenerator';
import { parseURDF } from './services/urdfParser';
import { generateRobotFromPrompt } from './services/geminiService';
import { DEFAULT_MOTOR_LIBRARY } from './services/motorLibrary';
import { translations, Language } from './services/i18n';
import { Download, Activity, Box, Cpu, Upload, Sparkles, X, Loader2, Check, ArrowRight, Github, Globe, ChevronDown, FileJson, Folder } from 'lucide-react';
import JSZip from 'jszip';

const INITIAL_ID = 'base_link';

const INITIAL_STATE: RobotState = {
  name: 'my_robot',
  links: {
    [INITIAL_ID]: { ...DEFAULT_LINK, id: INITIAL_ID, name: 'base_link', visual: { ...DEFAULT_LINK.visual, color: '#64748b' } }
  },
  joints: {},
  rootLinkId: INITIAL_ID,
  selection: { type: 'link', id: INITIAL_ID },
};

export type AppMode = 'skeleton' | 'detail' | 'hardware';

export default function App() {
  const [robot, setRobot] = useState<RobotState>(INITIAL_STATE);
  const [appMode, setAppMode] = useState<AppMode>('skeleton');
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [motorLibrary, setMotorLibrary] = useState<Record<string, MotorSpec[]>>(DEFAULT_MOTOR_LIBRARY);
  const [originalUrdfContent, setOriginalUrdfContent] = useState<string>('');
  const importInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Sidebar collapse state
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);

  // Language State
  const [lang, setLang] = useState<Language>('en');
  const t = translations[lang];

  // AI Modal State
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiResponse, setAiResponse] = useState<{ explanation: string, type: string, data?: any } | null>(null);

  // --- Actions ---

  const handleSelect = (type: 'link' | 'joint', id: string) => {
    setRobot(prev => ({ ...prev, selection: { type, id } }));
  };

  const handleNameChange = (name: string) => {
    setRobot(prev => ({ ...prev, name }));
  };

  const handleUpdate = (type: 'link' | 'joint', id: string, data: any) => {
    setRobot(prev => ({
      ...prev,
      [type === 'link' ? 'links' : 'joints']: {
        ...prev[type === 'link' ? 'links' : 'joints'],
        [id]: data
      }
    }));
  };

  const handleAddChild = (parentId: string) => {
    const newLinkId = `link_${Date.now()}`;
    const newJointId = `joint_${Date.now()}`;

    // Find existing children (siblings of the new joint) to calculate a non-overlapping position
    const siblings = Object.values(robot.joints).filter((j: UrdfJoint) => j.parentLinkId === parentId);
    // Simple heuristic: Offset along Y axis based on the number of existing siblings
    const yOffset = siblings.length * 0.5;

    const newLink: UrdfLink = {
      ...DEFAULT_LINK,
      id: newLinkId,
      name: `link_${Object.keys(robot.links).length + 1}`,
      visual: { ...DEFAULT_LINK.visual, color: '#3b82f6' } // Default Blue
    };

    const newJoint: UrdfJoint = {
      ...DEFAULT_JOINT,
      id: newJointId,
      name: `joint_${Object.keys(robot.joints).length + 1}`,
      parentLinkId: parentId,
      childLinkId: newLinkId,
      origin: { 
        xyz: { x: 0, y: yOffset, z: 0.5 }, 
        rpy: { r: 0, p: 0, y: 0 } 
      },
    };

    setRobot(prev => ({
      ...prev,
      links: { ...prev.links, [newLinkId]: newLink },
      joints: { ...prev.joints, [newJointId]: newJoint },
      selection: { type: 'joint', id: newJointId } // Auto select new JOINT
    }));
  };

  const handleDelete = (linkId: string) => {
      if(linkId === robot.rootLinkId) return; // Cannot delete root
      
      const toDeleteLinks = new Set<string>();
      const toDeleteJoints = new Set<string>();

      // Use a visited set to avoid infinite recursion if there are cycles
      const collect = (lId: string, visited: Set<string>) => {
          if (visited.has(lId)) return;
          visited.add(lId);

          toDeleteLinks.add(lId);
          // Find joints where this link is parent
          Object.values(robot.joints).forEach((j: UrdfJoint) => {
              if (j.parentLinkId === lId) {
                  toDeleteJoints.add(j.id);
                  collect(j.childLinkId, visited);
              }
              // Also find the joint that connects TO this link to delete it
              if (j.childLinkId === lId) {
                  toDeleteJoints.add(j.id);
              }
          });
      };

      collect(linkId, new Set<string>());

      const newLinks = { ...robot.links };
      const newJoints = { ...robot.joints };

      toDeleteLinks.forEach(id => delete newLinks[id]);
      toDeleteJoints.forEach(id => delete newJoints[id]);

      setRobot(prev => ({
          ...prev,
          links: newLinks,
          joints: newJoints,
          selection: { type: null, id: null }
      }));
  };

  const handleUploadAsset = (file: File) => {
    const url = URL.createObjectURL(file);
    setAssets(prev => ({ ...prev, [file.name]: url }));
  };

  const generateBOM = (robot: RobotState): string => {
      const headers = ['Joint Name', 'Type', 'Motor Type', 'Motor ID', 'Direction', 'Armature', 'Lower Limit', 'Upper Limit'];
      const rows = Object.values(robot.joints).map(j => {
          if (j.type === 'fixed') return null;
          // Skip if motor type is None or empty
          if (!j.hardware?.motorType || j.hardware.motorType === 'None') return null;
          
          return [
              j.name,
              j.type,
              j.hardware?.motorType,
              j.hardware?.motorId || '',
              j.hardware?.motorDirection || 1,
              j.hardware?.armature || 0,
              j.limit.lower,
              j.limit.upper
          ].join(',');
      }).filter(row => row !== null);

      return [headers.join(','), ...rows].join('\n');
  };

  const handleExport = async () => {
    const zip = new JSZip();
    const folderName = robot.name;
    const urdfFolder = zip.folder("urdf");
    const meshFolder = zip.folder("meshes");
    const hardwareFolder = zip.folder("hardware");
    const mujocoFolder = zip.folder("mujoco");

    // 1. Generate Standard URDF
    const xml = generateURDF(robot, false);
    urdfFolder?.file(`${robot.name}.urdf`, xml);

    // 2. Generate Extended URDF (with hardware info)
    const extendedXml = generateURDF(robot, true);
    urdfFolder?.file(`${robot.name}_extended.urdf`, extendedXml);

    // 3. Generate BOM
    const bomCsv = generateBOM(robot);
    hardwareFolder?.file("bom_list.csv", bomCsv);
    
    // 4. Generate MuJoCo XML
    const mujocoXml = generateMujocoXML(robot);
    mujocoFolder?.file(`${robot.name}.xml`, mujocoXml);

    // 5. Add Meshes
    const referencedFiles = new Set<string>();
    Object.values(robot.links).forEach((link: UrdfLink) => {
        if (link.visual.type === GeometryType.MESH && link.visual.meshPath) {
            referencedFiles.add(link.visual.meshPath);
        }
        if (link.collision && link.collision.type === GeometryType.MESH && link.collision.meshPath) {
            referencedFiles.add(link.collision.meshPath);
        }
    });

    const promises: Promise<void>[] = [];
    referencedFiles.forEach(fileName => {
        const blobUrl = assets[fileName];
        if (blobUrl) {
            const p = fetch(blobUrl)
                .then(res => res.blob())
                .then(blob => {
                    meshFolder?.file(fileName, blob);
                })
                .catch((err: any) => console.error(`Failed to load mesh ${fileName}`, err));
            promises.push(p);
        }
    });

    await Promise.all(promises);

    zip.generateAsync({ type: "blob" })
        .then(function(content: Blob) {
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${robot.name}_package.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Helper to process a "virtual filesystem" (map of filename -> blob/url)
    const processVirtualFS = async (
        urdfFile: { name: string, content: string }, 
        assetFiles: { name: string, blob: Blob }[],
        libraryFiles: { path: string, content: string }[]
    ) => {
        // 0. Process Motor Library if found
        if (libraryFiles.length > 0) {
             const newLibrary: Record<string, MotorSpec[]> = { ...DEFAULT_MOTOR_LIBRARY };
             libraryFiles.forEach(f => {
                 try {
                     const parts = f.path.split('/');
                     // Expecting .../Brand/Motor.txt
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

        // 1. Process URDF
        if (!urdfFile) {
            if (libraryFiles.length > 0) {
                alert("Library imported successfully!");
                return;
            }
            alert("No URDF file found.");
            return;
        }

        const newState = parseURDF(urdfFile.content);
        if (newState) {
            // Save original URDF content for URDFViewer
            setOriginalUrdfContent(urdfFile.content);
            
            // 2. Load Assets
            const newAssets: Record<string, string> = {};
            const assetPromises = assetFiles.map(async f => {
                 const ext = f.name.split('.').pop()?.toLowerCase();
                 if (['stl', 'obj', 'dae', 'png', 'jpg', 'jpeg', 'tga', 'bmp', 'tiff', 'tif', 'webp'].includes(ext || '')) {
                     // Use basename for simple matching
                     const filename = f.name.split('/').pop()!;
                     const url = URL.createObjectURL(f.blob);
                     newAssets[filename] = url;
                 }
            });
            await Promise.all(assetPromises);

            // Cleanup old assets
            Object.values(assets).forEach(url => URL.revokeObjectURL(url));
            
            setAssets(newAssets);
            setRobot(newState);
            setAppMode('detail'); // Start with detail mode
        } else {
            alert("Failed to parse URDF.");
        }
    };

    try {
        // Mode 1: Single ZIP file
        if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
            const zip = await JSZip.loadAsync(files[0]);
            
            let urdfFile: { name: string, content: string } | null = null;
            const assetFiles: { name: string, blob: Blob }[] = [];
            const libraryFiles: { path: string, content: string }[] = [];

            // Iterate ZIP
            const promises: Promise<void>[] = [];
            zip.forEach((relativePath, fileEntry) => {
                if (fileEntry.dir) return;
                
                const lowerPath = relativePath.toLowerCase();
                const p = (async () => {
                    if (lowerPath.endsWith('.urdf')) {
                        const content = await fileEntry.async("string");
                        if (!urdfFile) urdfFile = { name: relativePath, content };
                    } else if (lowerPath.includes('motor library') && lowerPath.endsWith('.txt')) {
                        const content = await fileEntry.async("string");
                        libraryFiles.push({ path: relativePath, content });
                    } else {
                        // Assume asset
                        const blob = await fileEntry.async("blob");
                        assetFiles.push({ name: relativePath, blob });
                    }
                })();
                promises.push(p);
            });
            await Promise.all(promises);

            // Use the generic processor
            await processVirtualFS(urdfFile!, assetFiles, libraryFiles);

        } else {
            // Mode 2: Multiple Files (Folder upload or Multi-select)
            const fileList = Array.from(files);
            
            let urdfFile: { name: string, content: string } | null = null;
            const assetFiles: { name: string, blob: Blob }[] = [];
            const libraryFiles: { path: string, content: string }[] = [];

            const promises = fileList.map(async f => {
                const lowerName = f.name.toLowerCase();
                // Note: file.webkitRelativePath gives path if directory upload, else just empty or filename
                const path = f.webkitRelativePath || f.name;

                if (lowerName.endsWith('.urdf')) {
                    const content = await f.text();
                    if (!urdfFile) urdfFile = { name: path, content };
                } else if (path.includes('motor library') && lowerName.endsWith('.txt')) {
                    const content = await f.text();
                    libraryFiles.push({ path: path, content });
                } else {
                    assetFiles.push({ name: path, blob: f });
                }
            });
            await Promise.all(promises);

            await processVirtualFS(urdfFile!, assetFiles, libraryFiles);
        }

    } catch (error: any) {
        console.error("Import failed:", error);
        alert("Failed to import. Please check if the file(s) are valid.");
    } finally {
        if (importInputRef.current) importInputRef.current.value = "";
        if (importFolderInputRef.current) importFolderInputRef.current.value = "";
    }
  };

  const handleGenerateAI = async () => {
    if (!aiPrompt.trim()) return;
    
    setIsGeneratingAI(true);
    setAiResponse(null); // Clear previous
    try {
        console.log('[AI] 开始生成，检查环境变量:', {
          hasApiKey: !!process.env.API_KEY,
          baseURL: process.env.OPENAI_BASE_URL,
          model: process.env.OPENAI_MODEL
        });
        
        const response = await generateRobotFromPrompt(aiPrompt, robot, motorLibrary);
        console.log('[AI] 收到响应:', response);
        
        if (response) {
            setAiResponse({
                explanation: response.explanation || '未收到有效响应',
                type: response.actionType || 'advice',
                data: response.robotData
            });
        } else {
            setAiResponse({
                explanation: 'AI 服务未返回响应，请重试。',
                type: 'advice',
                data: undefined
            });
        }
    } catch (e: any) {
        console.error("AI Generation Error", e);
        const errorMessage = e?.message || '未知错误';
        setAiResponse({
            explanation: `生成失败: ${errorMessage}\n\n请检查浏览器控制台获取详细信息。`,
            type: 'advice',
            data: undefined
        });
    } finally {
        setIsGeneratingAI(false);
    }
  };

  const applyAIChanges = () => {
      console.log('[Apply Changes] aiResponse:', aiResponse);
      console.log('[Apply Changes] aiResponse.data:', aiResponse?.data);
      
      if (aiResponse?.data) {
          const generated = aiResponse.data;
          console.log('[Apply Changes] Generated data:', {
            name: generated.name,
            linksCount: generated.links ? Object.keys(generated.links).length : 0,
            jointsCount: generated.joints ? Object.keys(generated.joints).length : 0,
            rootLinkId: generated.rootLinkId,
            links: generated.links,
            joints: generated.joints
          });
          
          if (!generated.links || Object.keys(generated.links).length === 0) {
              console.warn('[Apply Changes] No links found in generated data');
              alert('生成的机器人数据中没有链接，无法应用更改。');
              return;
          }
          
          try {
              setRobot(prev => {
                  const newState = {
                    ...prev,
                    name: generated.name || prev.name,
                    links: generated.links as Record<string, UrdfLink>,
                    joints: generated.joints as Record<string, UrdfJoint>,
                    rootLinkId: generated.rootLinkId || prev.rootLinkId,
                    selection: { type: 'link' as const, id: generated.rootLinkId || prev.rootLinkId }
                  };
                  console.log('[Apply Changes] New robot state:', {
                    name: newState.name,
                    linksCount: Object.keys(newState.links).length,
                    jointsCount: Object.keys(newState.joints).length,
                    rootLinkId: newState.rootLinkId
                  });
                  return newState;
              });
              setAppMode('skeleton');
              setIsAIModalOpen(false);
              setAiPrompt('');
              setAiResponse(null);
              console.log('[Apply Changes] Changes applied successfully');
          } catch (error) {
              console.error('[Apply Changes] Error applying changes:', error);
              alert(`应用更改时出错: ${error instanceof Error ? error.message : '未知错误'}`);
          }
      } else {
          console.warn('[Apply Changes] No data in aiResponse');
          alert('没有可应用的数据。');
      }
  };

  // --- Drag and Drop Handlers ---

  const traverseFileTree = async (item: any, path = ""): Promise<File[]> => {
      if (item.isFile) {
          return new Promise((resolve) => {
              item.file((file: File) => {
                  // Add webkitRelativePath property manually if missing, or just rely on path
                  // We can't easily modify File object properties, but we can wrap it or just return it.
                  // However, our logic uses f.name or f.webkitRelativePath.
                  // Let's try to define a property on the file object if possible, or return a wrapper.
                  // Actually, for our logic, we just need the file content and a way to know its path.
                  // But our handleImport logic expects File objects.
                  // Let's attach the path to the file object as a custom property if needed, 
                  // but standard File object from drag-drop usually has empty webkitRelativePath.
                  // We can use a custom property or just rely on the fact that we are building a list.
                  // Wait, handleImport logic uses `f.webkitRelativePath || f.name`.
                  // If we can't set webkitRelativePath, we might need to adjust handleImport to accept a structure.
                  // BUT, to minimize changes, let's see if we can define the property.
                  Object.defineProperty(file, 'webkitRelativePath', {
                      value: path + file.name
                  });
                  resolve([file]);
              });
          });
      } else if (item.isDirectory) {
          const dirReader = item.createReader();
          const entries: any[] = [];
          
          const readEntries = async (): Promise<any[]> => {
              return new Promise((resolve, reject) => {
                  dirReader.readEntries((results: any[]) => {
                      if (results.length) {
                          entries.push(...results);
                          resolve(readEntries()); // Recursively read until empty
                      } else {
                          resolve(entries);
                      }
                  }, (error: any) => reject(error));
              });
          };

          await readEntries();
          
          const files: File[] = [];
          for (const entry of entries) {
              const nestedFiles = await traverseFileTree(entry, path + item.name + "/");
              files.push(...nestedFiles);
          }
          return files;
      }
      return [];
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const items = e.dataTransfer.items;
      if (!items) return;

      const files: File[] = [];
      const promises: Promise<File[]>[] = [];

      for (let i = 0; i < items.length; i++) {
          const item = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
          if (item) {
              promises.push(traverseFileTree(item));
          } else {
              // Fallback for non-webkit browsers or if getAsEntry fails
              const file = items[i].getAsFile();
              if (file) files.push(file);
          }
      }

      const nestedFiles = await Promise.all(promises);
      nestedFiles.forEach(fileList => files.push(...fileList));

      if (files.length > 0) {
          // Create a synthetic event to reuse handleImport
          const syntheticEvent = {
              target: { files: files }
          } as unknown as React.ChangeEvent<HTMLInputElement>;
          
          handleImport(syntheticEvent);
      }
  };

  return (
    <div 
        className={`flex flex-col h-screen bg-slate-950 text-slate-200 font-sans ${isDragOver ? 'ring-4 ring-blue-500 ring-inset' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
    >
      <input 
        type="file" 
        // Accept common 3D formats and archives, plus any for wide compatibility
        // Removing specific accept to ensure user can select whatever they want
        ref={importInputRef} 
        onChange={handleImport} 
        className="hidden" 
        multiple
        // Removed webkitdirectory to allow file selection (including zip). 
        // Folder upload is supported via Drag & Drop.
      />
      <input 
        type="file" 
        ref={importFolderInputRef} 
        onChange={handleImport} 
        className="hidden" 
        multiple
        {...({ webkitdirectory: "", directory: "" } as any)}
      />

      {/* Header */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 shrink-0 relative">
        <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white tracking-tight">{t.appName}</h1>
            
            <button 
                onClick={() => setLang(prev => prev === 'en' ? 'zh' : 'en')}
                className="flex items-center justify-center p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded transition-colors"
                title="Switch Language"
            >
                <Globe className="w-4 h-4" />
                <span className="ml-1 text-xs font-bold">{lang === 'en' ? 'EN' : '中'}</span>
            </button>

            <a 
                href="https://github.com/OpenLegged/URDF-Architect"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded transition-colors"
                title="View on GitHub"
            >
                <Github className="w-4 h-4" />
            </a>
        </div>

        {/* Mode Switcher */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex bg-slate-800 rounded-lg p-1 border border-slate-700">
            <button 
                onClick={() => setAppMode('skeleton')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${appMode === 'skeleton' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
                <Activity className="w-4 h-4" />
                {t.skeleton}
            </button>
            <button 
                onClick={() => setAppMode('detail')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${appMode === 'detail' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
                <Box className="w-4 h-4" />
                {t.detail}
            </button>
            <button 
                onClick={() => setAppMode('hardware')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${appMode === 'hardware' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
                <Cpu className="w-4 h-4" />
                {t.hardware}
            </button>
        </div>

        <div className="flex items-center gap-2">
            <button
                onClick={() => { setIsAIModalOpen(true); setAiResponse(null); setAiPrompt(''); }}
                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded text-sm transition-all shadow-md"
            >
                <Sparkles className="w-4 h-4" />
                {t.aiAssistant}
            </button>
            <button 
                onClick={() => importFolderInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-sm transition-colors"
                title={t.importFolder}
            >
                <Download className="w-4 h-4" />
                {t.import}
            </button>
            <button 
                onClick={handleExport}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition-colors"
            >
                <Upload className="w-4 h-4" />
                {t.export}
            </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        <TreeEditor 
            robot={robot} 
            onSelect={handleSelect} 
            onAddChild={handleAddChild}
            onDelete={handleDelete}
            onNameChange={handleNameChange}
            mode={appMode}
            lang={lang}
            collapsed={leftSidebarCollapsed}
            onToggle={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
        />
        
        {(appMode === 'detail' || appMode === 'hardware') && originalUrdfContent ? (
            <URDFViewer
                urdfContent={originalUrdfContent}
                assets={assets}
                lang={lang}
                mode={appMode}
            />
        ) : (
            <Visualizer 
                robot={robot} 
                onSelect={handleSelect}
                onUpdate={handleUpdate}
                mode={appMode}
                assets={assets}
                lang={lang}
            />
        )}
        
        <PropertyEditor 
            robot={robot} 
            onUpdate={handleUpdate}
            mode={appMode}
            assets={assets}
            onUploadAsset={handleUploadAsset}
            motorLibrary={motorLibrary}
            lang={lang}
            collapsed={rightSidebarCollapsed}
            onToggle={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
        />
      </div>

      {/* AI Assistant Modal */}
      {isAIModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-slate-800 rounded-lg shadow-2xl w-full max-w-lg border border-slate-700 flex flex-col max-h-[90vh]">
                  <div className="flex items-center justify-between p-4 border-b border-slate-700 shrink-0">
                      <div className="flex items-center gap-2">
                          <Sparkles className="w-5 h-5 text-purple-400" />
                          <h2 className="text-lg font-bold text-white">{t.aiTitle}</h2>
                      </div>
                      <button onClick={() => setIsAIModalOpen(false)} className="text-slate-400 hover:text-white">
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  
                  <div className="p-4 flex-1 overflow-y-auto">
                      {!aiResponse ? (
                          <>
                            <p className="text-sm text-slate-400 mb-3">
                                {t.aiIntro}
                            </p>
                            <p className="text-xs text-slate-500 mb-3 italic whitespace-pre-wrap">
                                {t.aiExamples}
                            </p>
                            <textarea 
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                className="w-full h-32 bg-slate-900 border border-slate-700 rounded p-3 text-slate-200 text-sm focus:border-purple-500 focus:outline-none resize-none"
                                placeholder={t.aiPlaceholder}
                            />
                          </>
                      ) : (
                          <div className="space-y-4">
                              <div className="bg-slate-900/50 p-3 rounded border border-slate-700">
                                  <div className="text-xs text-slate-500 uppercase font-bold mb-1">{t.yourRequest}</div>
                                  <div className="text-sm text-slate-300">{aiPrompt}</div>
                              </div>
                              
                              <div className="bg-purple-900/20 p-3 rounded border border-purple-500/30">
                                  <div className="flex items-center gap-2 mb-1">
                                      <Sparkles className="w-3 h-3 text-purple-400" />
                                      <div className="text-xs text-purple-300 uppercase font-bold">
                                          {t.aiResponse} {aiResponse.type ? `(${aiResponse.type})` : ''}
                                      </div>
                                  </div>
                                  <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                                      {aiResponse.explanation || '正在处理...'}
                                  </div>
                              </div>
                              
                              {aiResponse.data && (
                                  <div className="flex items-center gap-2 text-xs text-yellow-500 bg-yellow-900/20 p-2 rounded border border-yellow-700/30">
                                      <Box className="w-3 h-3" />
                                      {t.actionWarning}
                                  </div>
                              )}
                          </div>
                      )}
                  </div>

                  <div className="p-4 border-t border-slate-700 flex justify-between gap-2 shrink-0">
                      {aiResponse ? (
                          <>
                             <button 
                                onClick={() => { setAiResponse(null); }}
                                className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                             >
                                {t.back}
                             </button>
                             {aiResponse.data && (
                                <button 
                                    onClick={applyAIChanges}
                                    className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded transition-colors flex items-center gap-2"
                                >
                                    <Check className="w-4 h-4" />
                                    {t.applyChanges}
                                </button>
                             )}
                          </>
                      ) : (
                          <>
                            <button 
                                onClick={() => setIsAIModalOpen(false)}
                                className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
                            >
                                {t.cancel}
                            </button>
                            <button 
                                onClick={handleGenerateAI}
                                disabled={isGeneratingAI || !aiPrompt.trim()}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm rounded transition-colors flex items-center gap-2"
                            >
                                {isGeneratingAI ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        {t.thinking}
                                    </>
                                ) : (
                                    <>
                                        <ArrowRight className="w-4 h-4" />
                                        {t.send}
                                    </>
                                )}
                            </button>
                          </>
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
