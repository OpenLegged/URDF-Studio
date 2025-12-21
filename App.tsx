
import React, { useState, useRef } from 'react';
import { TreeEditor } from './components/TreeEditor';
import { PropertyEditor } from './components/PropertyEditor';
import { Visualizer } from './components/Visualizer';
import { RobotState, DEFAULT_LINK, DEFAULT_JOINT, UrdfLink, UrdfJoint, GeometryType, MotorSpec } from './types';
import { generateURDF } from './services/urdfGenerator';
import { generateMujocoXML } from './services/mujocoGenerator';
import { parseURDF } from './services/urdfParser';
import { generateRobotFromPrompt } from './services/geminiService';
import { DEFAULT_MOTOR_LIBRARY } from './services/motorLibrary';
import { translations, Language } from './services/i18n';
import { Download, Activity, Box, Cpu, Upload, Sparkles, X, Loader2, Check, ArrowRight, Github, Globe } from 'lucide-react';
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
  const importInputRef = useRef<HTMLInputElement>(null);

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
    const file = e.target.files?.[0];
    if (!file) return;

    try {
        const zip = await JSZip.loadAsync(file);
        
        // 0. Parse Motor Library (if present)
        // Expected structure: library/motor library/[Brand]/[MotorName].txt
        const libraryFolder = zip.folder("library/motor library");
        if (libraryFolder) {
            const newLibrary: Record<string, MotorSpec[]> = { ...DEFAULT_MOTOR_LIBRARY };
            
            const libPromises: Promise<void>[] = [];
            
            libraryFolder.forEach((relativePath: string, fileEntry: any) => {
                if (!fileEntry.dir && relativePath.endsWith('.txt')) {
                    // Path is like "Brand/Motor.txt"
                    const parts = relativePath.split('/');
                    if (parts.length === 2) {
                        const brand = parts[0];
                        const p = fileEntry.async("string").then((content: string) => {
                            try {
                                const spec = JSON.parse(content) as MotorSpec;
                                if (!newLibrary[brand]) newLibrary[brand] = [];
                                // Avoid duplicates
                                if (!newLibrary[brand].some(m => m.name === spec.name)) {
                                    newLibrary[brand].push(spec);
                                }
                            } catch (err: any) {
                                console.warn("Failed to parse motor spec", relativePath);
                            }
                        });
                        libPromises.push(p);
                    }
                }
            });
            await Promise.all(libPromises);
            setMotorLibrary(newLibrary);
        }

        // 1. Find and Parse URDF
        // Search in root or 'urdf/' folder
        const urdfFiles = zip.file(/\.urdf$/i);
        if (urdfFiles.length === 0) {
            // It might be just a library import? 
            if (libraryFolder) {
                alert("Library imported successfully!");
                return;
            }
            alert("No URDF file found in the archive.");
            return;
        }

        const urdfContent = await urdfFiles[0].async("string") as string;
        const newState = parseURDF(urdfContent);

        if (newState) {
            // 2. Load Assets (Meshes)
            // Look for any supported mesh files in the ZIP, regardless of folder
            const newAssets: Record<string, string> = {};
            const meshPromises: Promise<void>[] = [];
            
            zip.forEach((relativePath: string, fileEntry: any) => {
                if (fileEntry.dir) return;
                
                const ext = relativePath.split('.').pop()?.toLowerCase();
                if (['stl', 'obj', 'dae'].includes(ext || '')) {
                     const p = fileEntry.async("blob").then((blob: Blob) => {
                         // We use the basename as the key, because URDF usually references "package://robot/meshes/basename.stl"
                         // and our parser extracts just "basename.stl".
                         const filename = relativePath.split('/').pop()!; 
                         const url = URL.createObjectURL(blob);
                         newAssets[filename] = url;
                     });
                     meshPromises.push(p);
                }
            });
            
            await Promise.all(meshPromises);

            // Cleanup old assets
            Object.values(assets).forEach(url => URL.revokeObjectURL(url));
            
            setAssets(newAssets);
            setRobot(newState);
            setAppMode('skeleton'); // Reset view
        } else {
            alert("Failed to parse URDF.");
        }

    } catch (error: any) {
        console.error("Import failed:", error);
        alert("Failed to import package. Ensure it is a valid zip file.");
    } finally {
        if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const handleGenerateAI = async () => {
    if (!aiPrompt.trim()) return;
    
    setIsGeneratingAI(true);
    setAiResponse(null); // Clear previous
    try {
        const response = await generateRobotFromPrompt(aiPrompt, robot, motorLibrary);
        if (response) {
            setAiResponse({
                explanation: response.explanation,
                type: response.actionType,
                data: response.robotData
            });
        } else {
            alert("Failed to get a response from AI.");
        }
    } catch (e: any) {
        console.error("AI Generation Error", e);
        const errorMessage = e?.message || '未知错误';
        alert(`生成失败: ${errorMessage}\n\n请检查浏览器控制台获取详细信息。`);
    } finally {
        setIsGeneratingAI(false);
    }
  };

  const applyAIChanges = () => {
      if (aiResponse?.data) {
          const generated = aiResponse.data;
          setRobot(prev => ({
            ...prev,
            name: generated.name || prev.name,
            links: generated.links as Record<string, UrdfLink>,
            joints: generated.joints as Record<string, UrdfJoint>,
            rootLinkId: generated.rootLinkId || prev.rootLinkId,
            selection: { type: 'link', id: generated.rootLinkId || prev.rootLinkId }
          }));
          setAppMode('skeleton');
          setIsAIModalOpen(false);
          setAiPrompt('');
          setAiResponse(null);
      }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 font-sans">
      <input 
        type="file" 
        accept=".zip" 
        ref={importInputRef} 
        onChange={handleImport} 
        className="hidden" 
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
                onClick={() => importInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-sm transition-colors"
            >
                <Upload className="w-4 h-4" />
                {t.import}
            </button>
            <button 
                onClick={handleExport}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition-colors"
            >
                <Download className="w-4 h-4" />
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
        />
        
        <Visualizer 
            robot={robot} 
            onSelect={handleSelect}
            onUpdate={handleUpdate}
            mode={appMode}
            assets={assets}
            lang={lang}
        />
        
        <PropertyEditor 
            robot={robot} 
            onUpdate={handleUpdate}
            mode={appMode}
            assets={assets}
            onUploadAsset={handleUploadAsset}
            motorLibrary={motorLibrary}
            lang={lang}
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
                                      <div className="text-xs text-purple-300 uppercase font-bold">{t.aiResponse} ({aiResponse.type})</div>
                                  </div>
                                  <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                                      {aiResponse.explanation}
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
