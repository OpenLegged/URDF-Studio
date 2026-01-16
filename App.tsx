import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useHistory } from './hooks/useHistory';
import { TreeEditor } from './components/TreeEditor';
import { PropertyEditor } from './components/PropertyEditor';
import { Visualizer } from './components/Visualizer';
import { URDFViewer } from './components/URDFViewer';
import { SourceCodeEditor } from './components/SourceCodeEditor';
import { RobotState, DEFAULT_LINK, DEFAULT_JOINT, UrdfLink, UrdfJoint, GeometryType, MotorSpec, Theme, InspectionReport, InspectionIssue } from './types';
import { generateURDF } from './services/urdfGenerator';
import { generateMujocoXML } from './services/mujocoGenerator';
import { parseURDF } from './services/urdfParser';
import { parseMJCF, isMJCF } from './services/mjcfParser';
import { parseUSDA, isUSDA } from './services/usdParser';
import { generateRobotFromPrompt, runRobotInspection } from './services/geminiService';
import { DEFAULT_MOTOR_LIBRARY } from './services/motorLibrary';
import { translations, Language } from './services/i18n';
import { INSPECTION_CRITERIA, getInspectionCategory } from './services/inspectionCriteria';
import { Download, Activity, Box, Cpu, Upload, Sparkles, X, Loader2, Check, ArrowRight, Github, Globe, ScanSearch, AlertTriangle, Info, AlertCircle, Move, ChevronDown, ChevronRight, FileText, RefreshCw, MessageCircle, Send, FileJson, Folder, Heart, Sun, Moon, Briefcase, Undo, Redo, RotateCcw, RotateCw, History, Code } from 'lucide-react';
import JSZip from 'jszip';
import jsPDF from 'jspdf';

const INITIAL_ID = 'base_link';

type RobotData = Omit<RobotState, 'selection'>;

const INITIAL_ROBOT_DATA: RobotData = {
  name: 'my_robot',
  links: {
    [INITIAL_ID]: { ...DEFAULT_LINK, id: INITIAL_ID, name: 'base_link', visual: { ...DEFAULT_LINK.visual, color: '#64748b' } }
  },
  joints: {},
  rootLinkId: INITIAL_ID,
};

export type AppMode = 'skeleton' | 'detail' | 'hardware';

export default function App() {
  const { state: robotData, set: setRobotData, undo, redo, canUndo, canRedo, reset: resetRobotData } = useHistory<RobotData>(INITIAL_ROBOT_DATA);
  const [selection, setSelection] = useState<RobotState['selection']>({ type: null, id: null });

  const robot: RobotState = useMemo(() => ({ ...robotData, selection }), [robotData, selection]);

  const [appMode, setAppMode] = useState<AppMode>('skeleton');
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [motorLibrary, setMotorLibrary] = useState<Record<string, MotorSpec[]>>(DEFAULT_MOTOR_LIBRARY);
  const [originalUrdfContent, setOriginalUrdfContent] = useState<string>('');
  
  // Compute URDF content based on current robotData - this ensures undo/redo updates the 3D view
  const urdfContentForViewer = useMemo(() => {
    if (!originalUrdfContent) return '';
    // Regenerate URDF from current robotData to reflect any changes (including undo/redo)
    return generateURDF({ ...robotData, selection });
  }, [robotData, selection, originalUrdfContent]);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Clean up selection if the selected item no longer exists (e.g. after undo)
  useEffect(() => {
    if (selection.id && selection.type) {
      const exists = selection.type === 'link' 
        ? robotData.links[selection.id]
        : robotData.joints[selection.id];
      if (!exists) {
        setSelection({ type: null, id: null });
      }
    }
  }, [robotData, selection]);

  // Sidebar collapse state
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('leftSidebarCollapsed');
      return saved === 'true';
    }
    return false;
  });
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('rightSidebarCollapsed');
      return saved === 'true';
    }
    return false;
  });

  // Language State
  const [lang, setLang] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('language');
      if (saved === 'en' || saved === 'zh') {
        return saved;
      }
      const systemLang = navigator.language || (navigator as any).userLanguage;
      if (systemLang && systemLang.toLowerCase().startsWith('zh')) {
        return 'zh';
      }
    }
    return 'en';
  });
  const t = translations[lang];

  // Hover state for synchronized highlighting
  const [hoveredSelection, setHoveredSelection] = useState<RobotState['selection']>({ type: null, id: null });

  // Theme State
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark' || saved === 'light') {
        return saved;
      }
    }
    return 'light';
  });

  // OS Detection
  const [os, setOs] = useState<'mac' | 'win'>('win');
  useEffect(() => {
    if (typeof navigator !== 'undefined') {
        if (navigator.platform.toUpperCase().indexOf('MAC') >= 0) {
            setOs('mac');
        }
    }
  }, []);

  // AI Inspector Window State
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [aiPanelPos, setAiPanelPos] = useState({ x: 320, y: 80 }); // Initial position near top-left of visualizer
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  // Chat/Mod/Gen Response
  const [aiResponse, setAiResponse] = useState<{ explanation: string, type: string, data?: any } | null>(null);
  // Inspection Report
  const [inspectionReport, setInspectionReport] = useState<InspectionReport | null>(null);
  // Category expansion state
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(INSPECTION_CRITERIA.map(c => c.id)));
  // Selected inspection items (categoryId -> Set of itemIds)
  const [selectedItems, setSelectedItems] = useState<Record<string, Set<string>>>(() => {
    const initial: Record<string, Set<string>> = {};
    INSPECTION_CRITERIA.forEach(category => {
      initial[category.id] = new Set(category.items.map(item => item.id));
    });
    return initial;
  });
  // Inspection progress
  const [inspectionProgress, setInspectionProgress] = useState<{
    currentCategory?: string;
    currentItem?: string;
    completed: number;
    total: number;
  } | null>(null);
  // Report generation timer
  const [reportGenerationTimer, setReportGenerationTimer] = useState<number | null>(null);
  // Chat state for inspection report
  const [isReportChatOpen, setIsReportChatOpen] = useState(false);
  const [reportChatMessages, setReportChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [reportChatInput, setReportChatInput] = useState('');
  const [isChatGenerating, setIsChatGenerating] = useState(false);
  // Single item retest state
  const [retestingItem, setRetestingItem] = useState<{ categoryId: string; itemId: string } | null>(null);

  // Toast Notification State
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'info' | 'success' }>({ show: false, message: '', type: 'info' });
  
  // Menu State
  const [activeMenu, setActiveMenu] = useState<'file' | 'toolbox' | null>(null);
  const [isAboutMenuOpen, setIsAboutMenuOpen] = useState(false);
  const [isCodeViewerOpen, setIsCodeViewerOpen] = useState(false);

  const showPrivacyToast = () => {
      setToast({ 
          show: true, 
          message: lang === 'zh' 
            ? "提示：所有数据仅在您的本地浏览器中处理，不会上传到云端服务器，您的数据是安全的。" 
            : "Note: All data is processed locally in your browser and will NOT be uploaded to any cloud server. Your data is safe.",
          type: 'success'
      });
      setTimeout(() => setToast(prev => ({ ...prev, show: false })), 10000);
  };

  // Update theme class on document element
  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        if (canUndo) {
          undo();
          e.preventDefault();
        }
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
          if (canRedo) {
            redo();
            e.preventDefault();
          }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, canUndo, canRedo]);

  // Save language preference
  useEffect(() => {
    localStorage.setItem('language', lang);
    document.title = lang === 'zh' 
        ? "URDF Studio - 专业机器人设计与可视化工具" 
        : "URDF Studio - Professional Robot Design & Visualization Tool";
  }, [lang]);

  // Save sidebar collapse states
  useEffect(() => {
    localStorage.setItem('leftSidebarCollapsed', String(leftSidebarCollapsed));
  }, [leftSidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem('rightSidebarCollapsed', String(rightSidebarCollapsed));
  }, [rightSidebarCollapsed]);

  // --- Actions ---

  const handleSelect = (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => {
    setSelection({ type, id, subType });
  };

  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  
  const handleFocus = (id: string) => {
    setFocusTarget(id);
    // Clear it after a short delay so we can trigger it again even if clicking same item
    setTimeout(() => setFocusTarget(null), 100);
  };

  const handleNameChange = (name: string) => {
    setRobotData(prev => ({ ...prev, name }));
  };

  const handleUpdate = (type: 'link' | 'joint', id: string, data: any) => {
    setRobotData(prev => {
      const newState = {
        ...prev,
        [type === 'link' ? 'links' : 'joints']: {
          ...prev[type === 'link' ? 'links' : 'joints'],
          [id]: data
        }
      };
      
      return newState;
    });
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
      name: `joint_${Object.keys(robotData.joints).length + 1}`,
      parentLinkId: parentId,
      childLinkId: newLinkId,
      origin: { 
        xyz: { x: 0, y: yOffset, z: 0.5 }, 
        rpy: { r: 0, p: 0, y: 0 } 
      },
    };

    setRobotData(prev => ({
      ...prev,
      links: { ...prev.links, [newLinkId]: newLink },
      joints: { ...prev.joints, [newJointId]: newJoint },
    }));
    setSelection({ type: 'joint', id: newJointId });
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

      setRobotData(prev => ({
          ...prev,
          links: newLinks,
          joints: newJoints,
      }));
      setSelection({ type: null, id: null });
  };

  const handleUploadAsset = (file: File) => {
    const url = URL.createObjectURL(file);
    setAssets(prev => ({ ...prev, [file.name]: url }));
  };

  const generateBOM = (robot: RobotState): string => {
      const headers = lang === 'zh' 
        ? ['关节名称', '类型', '电机型号', '电机 ID', '方向', '电枢', '下限', '上限']
        : ['Joint Name', 'Type', 'Motor Type', 'Motor ID', 'Direction', 'Armature', 'Lower Limit', 'Upper Limit'];
      
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
    // Show privacy toast when import starts (after user confirms file selection)
    showPrivacyToast();
    
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Helper to process a "virtual filesystem" (map of filename -> blob/url)
    const processVirtualFS = async (
        robotFile: { name: string, content: string, format: 'urdf' | 'mjcf' | 'usd' } | null, 
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

        // 1. Process Robot File
        if (!robotFile) {
            if (libraryFiles.length > 0) {
                alert(lang === 'zh' ? "库导入成功！" : "Library imported successfully!");
                return;
            }
            alert(lang === 'zh' ? "未找到 URDF/MJCF/USD 文件。" : "No URDF/MJCF/USD file found.");
            return;
        }

        // Parse based on format
        let newState: RobotState | null = null;
        
        switch (robotFile.format) {
            case 'urdf':
                newState = parseURDF(robotFile.content);
                if (newState) {
                    setOriginalUrdfContent(robotFile.content);
                }
                break;
            case 'mjcf':
                newState = parseMJCF(robotFile.content);
                if (newState) {
                    // Clear URDF content since this is MJCF
                    setOriginalUrdfContent('');
                }
                break;
            case 'usd':
                newState = parseUSDA(robotFile.content);
                if (newState) {
                    // Clear URDF content since this is USD
                    setOriginalUrdfContent('');
                }
                break;
        }

        if (newState) {
            
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
            
            const { selection: newSelection, ...newData } = newState;
            resetRobotData(newData);
            setSelection({ type: null, id: null });
            
            setAppMode('detail'); // Start with detail mode
        } else {
            const msg = lang === 'zh' 
                ? `解析 ${robotFile.format.toUpperCase()} 文件失败。` 
                : `Failed to parse ${robotFile.format.toUpperCase()} file.`;
            alert(msg);
        }
    };

    // Helper to detect file format from content
    const detectFormat = (content: string, filename: string): 'urdf' | 'mjcf' | 'usd' | null => {
        const lowerName = filename.toLowerCase();
        
        // Check by extension first
        if (lowerName.endsWith('.urdf')) return 'urdf';
        if (lowerName.endsWith('.usda') || lowerName.endsWith('.usdc') || lowerName.endsWith('.usd')) return 'usd';
        
        // For XML files, check content
        if (lowerName.endsWith('.xml')) {
            if (isMJCF(content)) return 'mjcf';
            // Could also be URDF (though rare with .xml extension)
            if (content.includes('<robot')) return 'urdf';
        }
        
        // Try content-based detection
        if (isUSDA(content)) return 'usd';
        if (isMJCF(content)) return 'mjcf';
        if (content.includes('<robot')) return 'urdf';
        
        return null;
    };

    try {
        // Mode 1: Single ZIP file
        if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
            const zip = await JSZip.loadAsync(files[0]);
            
            let robotFile: { name: string, content: string, format: 'urdf' | 'mjcf' | 'usd' } | null = null;
            const assetFiles: { name: string, blob: Blob }[] = [];
            const libraryFiles: { path: string, content: string }[] = [];

            // Iterate ZIP
            const promises: Promise<void>[] = [];
            zip.forEach((relativePath, fileEntry) => {
                if (fileEntry.dir) return;
                
                const lowerPath = relativePath.toLowerCase();
                const p = (async () => {
                    // Check for robot definition files (URDF, MJCF, USD)
                    if (lowerPath.endsWith('.urdf') || lowerPath.endsWith('.xml') || 
                        lowerPath.endsWith('.usda') || lowerPath.endsWith('.usd')) {
                        const content = await fileEntry.async("string");
                        const format = detectFormat(content, relativePath);
                        if (format && !robotFile) {
                            robotFile = { name: relativePath, content, format };
                        }
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
            await processVirtualFS(robotFile, assetFiles, libraryFiles);

        } else {
            // Mode 2: Multiple Files (Folder upload or Multi-select)
            const fileList = Array.from(files);
            
            let robotFile: { name: string, content: string, format: 'urdf' | 'mjcf' | 'usd' } | null = null;
            const assetFiles: { name: string, blob: Blob }[] = [];
            const libraryFiles: { path: string, content: string }[] = [];

            const promises = fileList.map(async f => {
                const lowerName = f.name.toLowerCase();
                // Note: file.webkitRelativePath gives path if directory upload, else just empty or filename
                const path = f.webkitRelativePath || f.name;

                // Check for robot definition files (URDF, MJCF, USD)
                if (lowerName.endsWith('.urdf') || lowerName.endsWith('.xml') || 
                    lowerName.endsWith('.usda') || lowerName.endsWith('.usd')) {
                    const content = await f.text();
                    const format = detectFormat(content, f.name);
                    if (format && !robotFile) {
                        robotFile = { name: path, content, format };
                    }
                } else if (path.includes('motor library') && lowerName.endsWith('.txt')) {
                    const content = await f.text();
                    libraryFiles.push({ path: path, content });
                } else {
                    assetFiles.push({ name: path, blob: f });
                }
            });
            await Promise.all(promises);

            await processVirtualFS(robotFile, assetFiles, libraryFiles);
        }

    } catch (error: any) {
        console.error("Import failed:", error);
        alert(lang === 'zh' ? "导入失败。请检查文件是否有效。" : "Failed to import. Please check if the file(s) are valid.");
    } finally {
        if (importInputRef.current) importInputRef.current.value = "";
        if (importFolderInputRef.current) importFolderInputRef.current.value = "";
    }
  };

  const handleGenerateAI = async () => {
    if (!aiPrompt.trim()) return;
    
    setIsGeneratingAI(true);
    setAiResponse(null); // Clear previous
    setInspectionReport(null);
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

  const handleRunInspection = async () => {
      setIsGeneratingAI(true);
      setAiResponse(null);
      setInspectionReport(null);
      setReportGenerationTimer(null);
      
      // 计算总检查项数量和列表
      let totalItems = 0;
      const selectedItemsList: Array<{ categoryId: string; itemId: string; categoryName: string; itemName: string }> = [];
      Object.keys(selectedItems).forEach(categoryId => {
          const category = INSPECTION_CRITERIA.find(c => c.id === categoryId);
          if (!category) return;
          const categoryName = lang === 'zh' ? category.nameZh : category.name;
          const items = Array.from(selectedItems[categoryId]);
          items.forEach(itemId => {
              const item = category.items.find(i => i.id === itemId);
              if (item) {
                  const itemName = lang === 'zh' ? item.nameZh : item.name;
                  selectedItemsList.push({ categoryId, itemId, categoryName, itemName });
                  totalItems++;
              }
          });
      });
      
      // 将选中的项目转换为格式：{ categoryId: [itemId1, itemId2, ...] }
      const selectedItemsMap: Record<string, string[]> = {};
      Object.keys(selectedItems).forEach(categoryId => {
          const items = Array.from(selectedItems[categoryId]);
          if (items.length > 0) {
              selectedItemsMap[categoryId] = items;
          }
      });
      
      // 初始化进度
      setInspectionProgress({ completed: 0, total: totalItems });
      
      try {
          // 模拟逐条检查进度
          let currentIndex = 0;
          let reportReady = false;
          let generatedReport: InspectionReport | null = null;
          let timerInterval: NodeJS.Timeout | null = null;
          
          const progressInterval = setInterval(() => {
              currentIndex++;
              if (currentIndex <= totalItems) {
                  const currentItem = selectedItemsList[currentIndex - 1];
                  setInspectionProgress({
                      currentCategory: currentItem?.categoryName,
                      currentItem: currentItem?.itemName,
                      completed: currentIndex,
                      total: totalItems
                  });
              } else {
                  clearInterval(progressInterval);
                  
                  // 所有检查项完成后，立即开始计时并启动AI报告生成
                  setInspectionProgress({
                      currentCategory: undefined,
                      currentItem: undefined,
                      completed: totalItems,
                      total: totalItems
                  });
                  
                  // 立即启动报告生成计时器（从1秒开始，预计30秒）
                  setReportGenerationTimer(1);
                  let timerCount = 1;
                  
                  const showReport = () => {
                      if (timerInterval) {
                          clearInterval(timerInterval);
                          timerInterval = null;
                      }
                      setInspectionProgress(null);
                      setReportGenerationTimer(null);
                      if (generatedReport) {
                          setInspectionReport(generatedReport);
                      }
                  };
                  
                  timerInterval = setInterval(() => {
                      timerCount++;
                      setReportGenerationTimer(timerCount);
                      
                      // 如果计时器到30秒，显示报告（无论是否准备好）
                      if (timerCount >= 30) {
                          clearInterval(timerInterval!);
                          timerInterval = null;
                          if (reportReady) {
                              // 报告已准备好，立即显示
                              showReport();
                          } else {
                              // 报告还没准备好，等待报告
                              setReportGenerationTimer(null);
                              const checkReport = setInterval(() => {
                                  if (reportReady) {
                                      clearInterval(checkReport);
                                      showReport();
                                  }
                              }, 100);
                          }
                      }
                  }, 1000); // 每秒更新一次
                  
                  // 在后台生成报告（不阻塞UI）
                  runRobotInspection(robot, selectedItemsMap, lang).then(report => {
                      generatedReport = report;
                      reportReady = true;
                      // 如果报告在30秒内完成，立即显示（提前显示）
                      if (timerCount < 30 && timerInterval) {
                          clearInterval(timerInterval);
                          timerInterval = null;
                          showReport();
                      } else if (timerCount >= 30) {
                          // 如果计时器已经到30秒，立即显示报告
                          showReport();
                      }
                  }).catch(e => {
                      console.error("Inspection Error", e);
                      if (timerInterval) {
                          clearInterval(timerInterval);
                      }
                      setInspectionProgress(null);
                      setReportGenerationTimer(null);
                  });
              }
          }, 300); // 每300ms更新一次进度
      } catch(e: any) {
          console.error("Inspection Error", e);
          setInspectionProgress(null);
          setReportGenerationTimer(null);
      } finally {
          setIsGeneratingAI(false);
      }
  };

  const toggleCategorySelection = (categoryId: string) => {
      setSelectedItems(prev => {
          const newItems = { ...prev };
          const category = INSPECTION_CRITERIA.find(c => c.id === categoryId);
          if (!category) return prev;
          
          const allSelected = category.items.every(item => newItems[categoryId]?.has(item.id));
          if (allSelected) {
              // 取消全选
              newItems[categoryId] = new Set();
          } else {
              // 全选
              newItems[categoryId] = new Set(category.items.map(item => item.id));
          }
          return newItems;
      });
  };

  const toggleItemSelection = (categoryId: string, itemId: string) => {
      setSelectedItems(prev => {
          const newItems = { ...prev };
          if (!newItems[categoryId]) {
              newItems[categoryId] = new Set();
          }
          const itemSet = new Set(newItems[categoryId]);
          if (itemSet.has(itemId)) {
              itemSet.delete(itemId);
          } else {
              itemSet.add(itemId);
          }
          newItems[categoryId] = itemSet;
          return newItems;
      });
  };

  // Handle single item retest
  const handleRetestItem = async (categoryId: string, itemId: string) => {
    setRetestingItem({ categoryId, itemId });
    try {
      const selectedItemsMap: Record<string, string[]> = {
        [categoryId]: [itemId]
      };
      
      const report = await runRobotInspection(robot, selectedItemsMap, lang);
      if (report && inspectionReport) {
        // 更新现有报告，只更新该检测项相关的issues
        const updatedIssues = inspectionReport.issues.filter(issue => 
          !(issue.category === categoryId && issue.itemId === itemId)
        );
        // 添加新的检测结果
        const newIssues = report.issues.filter(issue => 
          issue.category === categoryId && issue.itemId === itemId
        );
        const allIssues = [...updatedIssues, ...newIssues];
        
        // 重新计算分数
        const categoryScores: Record<string, number> = { ...inspectionReport.categoryScores };
        const categoryIssues = allIssues.filter(i => i.category === categoryId);
        if (categoryIssues.length > 0) {
          const scores = categoryIssues.map(i => i.score ?? 10);
          categoryScores[categoryId] = scores.reduce((a, b) => a + b, 0) / scores.length;
        }
        
        const allScores = allIssues.map(i => i.score ?? 10);
        const overallScore = allScores.reduce((a, b) => a + b, 0);
        
        setInspectionReport({
          ...inspectionReport,
          issues: allIssues,
          categoryScores,
          overallScore,
          maxScore: inspectionReport.maxScore || 100
        });
      }
    } catch (e) {
      console.error("Retest Error", e);
    } finally {
      setRetestingItem(null);
    }
  };

  // Handle chat message for inspection report
  const handleReportChatSend = async () => {
    if (!reportChatInput.trim() || isChatGenerating || !inspectionReport) return;
    
    const userMessage = reportChatInput.trim();
    setReportChatInput('');
    setReportChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsChatGenerating(true);
    
    try {
      const contextPrompt = lang === 'zh'
        ? `当前机器人结构：\n${JSON.stringify(robot, null, 2)}\n\n检测报告摘要：\n${inspectionReport.summary}\n\n检测报告中的问题列表：\n${inspectionReport.issues.map(i => `- ${i.title} (${i.type}): ${i.description}${i.relatedIds ? ` [相关ID: ${i.relatedIds.join(', ')}]` : ''}`).join('\n')}\n\n用户问题：${userMessage}\n\n请回答用户关于检测报告中问题的询问，提供详细的解释、原因分析和建议。`
        : `Current robot structure:\n${JSON.stringify(robot, null, 2)}\n\nInspection report summary:\n${inspectionReport.summary}\n\nIssues in inspection report:\n${inspectionReport.issues.map(i => `- ${i.title} (${i.type}): ${i.description}${i.relatedIds ? ` [Related IDs: ${i.relatedIds.join(', ')}]` : ''}`).join('\n')}\n\nUser question: ${userMessage}\n\nPlease answer the user's question about issues in the inspection report, providing detailed explanations, cause analysis, and suggestions.`;
      
      const response = await generateRobotFromPrompt(contextPrompt, robot, motorLibrary);
      const assistantMessage = response?.explanation || (lang === 'zh' ? '抱歉，无法生成回复。' : 'Sorry, unable to generate response.');
      setReportChatMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }]);
    } catch (e) {
      console.error("Chat Error", e);
      setReportChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: lang === 'zh' ? '发送消息时出错，请重试。' : 'Error sending message, please try again.' 
      }]);
    } finally {
      setIsChatGenerating(false);
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
              const targetRootId = generated.rootLinkId || robotData.rootLinkId;
              setRobotData(prev => {
                  const newState = {
                    ...prev,
                    name: generated.name || prev.name,
                    links: generated.links as Record<string, UrdfLink>,
                    joints: generated.joints as Record<string, UrdfJoint>,
                    rootLinkId: generated.rootLinkId || prev.rootLinkId,
                  };
                  console.log('[Apply Changes] New robot state:', {
                    name: newState.name,
                    linksCount: Object.keys(newState.links).length,
                    jointsCount: Object.keys(newState.joints).length,
                    rootLinkId: newState.rootLinkId
                  });
                  return newState;
              });
              setSelection({ type: 'link', id: targetRootId });
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

  const handleCodeChange = (newCode: string) => {
    const newState = parseURDF(newCode);
    if (newState) {
      const { selection: newSelection, ...newData } = newState;
      setRobotData(newData);
    }
  };

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault(); 
    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = aiPanelPos.x;
    const initialY = aiPanelPos.y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        setAiPanelPos({ x: initialX + dx, y: initialY + dy });
    };

    const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleDownloadPDF = () => {
      if (!inspectionReport) return;

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      let yPos = margin;

      // 标题
      doc.setFontSize(20);
      doc.setTextColor(50, 50, 50);
      const reportTitle = lang === 'zh' ? 'URDF 机器人检查报告' : 'URDF Robot Inspection Report';
      doc.text(reportTitle, pageWidth / 2, yPos, { align: 'center' });
      yPos += 15;

      // 机器人名称
      doc.setFontSize(14);
      doc.setTextColor(100, 100, 100);
      const robotNameLabel = lang === 'zh' ? '机器人名称' : 'Robot Name';
      doc.text(`${robotNameLabel}: ${robot.name}`, margin, yPos);
      yPos += 10;

      // 检查日期
      const now = new Date();
      const dateStr = now.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const dateLabel = lang === 'zh' ? '检查日期' : 'Inspection Date';
      doc.text(`${dateLabel}: ${dateStr}`, margin, yPos);
      yPos += 15;

      // 总分
      const overallScore = inspectionReport.overallScore ?? 0;
      const maxScore = inspectionReport.maxScore ?? 100;
      doc.setFontSize(16);
      doc.setTextColor(50, 50, 50);
      const scoreLabel = lang === 'zh' ? '总分' : 'Overall Score';
      doc.text(`${scoreLabel}: ${overallScore.toFixed(1)}/${maxScore}`, margin, yPos);
      yPos += 10;

      // 进度条（简化版）
      const scorePercentage = (overallScore / maxScore) * 100;
      const barWidth = pageWidth - 2 * margin;
      const barHeight = 5;
      doc.setFillColor(200, 200, 200);
      doc.rect(margin, yPos, barWidth, barHeight, 'F');
      
      // 根据分数设置颜色
      let barColor: [number, number, number] = [239, 68, 68]; // 红色
      if (scorePercentage >= 90) {
          barColor = [34, 197, 94]; // 绿色
      } else if (scorePercentage >= 60) {
          barColor = [234, 179, 8]; // 黄色
      }
      doc.setFillColor(...barColor);
      doc.rect(margin, yPos, (barWidth * scorePercentage) / 100, barHeight, 'F');
      yPos += 15;

      // 总结
      doc.setFontSize(12);
      doc.setTextColor(50, 50, 50);
      doc.setFont(undefined, 'bold');
      const summaryLabel = lang === 'zh' ? '检查总结' : 'Inspection Summary';
      doc.text(summaryLabel, margin, yPos);
      yPos += 8;
      doc.setFont(undefined, 'normal');
      const summaryLines = doc.splitTextToSize(inspectionReport.summary, pageWidth - 2 * margin);
      doc.text(summaryLines, margin, yPos);
      yPos += summaryLines.length * 6 + 10;

      // 按章节分组展示
      const issuesByCategory: Record<string, typeof inspectionReport.issues> = {};
      INSPECTION_CRITERIA.forEach(category => {
        issuesByCategory[category.id] = [];
      });

      inspectionReport.issues.forEach(issue => {
        const categoryId = issue.category || 'physical';
        if (!issuesByCategory[categoryId]) {
          issuesByCategory[categoryId] = [];
        }
        issuesByCategory[categoryId].push(issue);
      });

      INSPECTION_CRITERIA.forEach(category => {
          // 检查是否需要新页面
          if (yPos > pageHeight - 40) {
              doc.addPage();
              yPos = margin;
          }

          const categoryIssues = issuesByCategory[category.id] || [];
          const categoryScore = inspectionReport.categoryScores?.[category.id] ?? 10;
          const categoryName = lang === 'zh' ? category.nameZh : category.name;

          // 章节标题
          doc.setFontSize(14);
          doc.setFont(undefined, 'bold');
          doc.setTextColor(50, 50, 50);
          doc.text(`${categoryName} (${categoryScore.toFixed(1)}/10)`, margin, yPos);
          yPos += 10;

          if (categoryIssues.length === 0) {
              doc.setFontSize(10);
              doc.setFont(undefined, 'normal');
              doc.setTextColor(34, 197, 94);
              const allPassedText = lang === 'zh' ? '✓ 该章节所有检查项均通过' : '✓ All checks passed for this category';
              doc.text(allPassedText, margin + 5, yPos);
              yPos += 8;
          } else {
              categoryIssues.forEach((issue, idx) => {
                  // 检查是否需要新页面
                  if (yPos > pageHeight - 30) {
                      doc.addPage();
                      yPos = margin;
                  }

                  const issueScore = issue.score ?? 10;
                  doc.setFontSize(10);
                  doc.setFont(undefined, 'bold');
                  
                  // 根据问题类型设置颜色
                  if (issue.type === 'error') {
                      doc.setTextColor(239, 68, 68);
                  } else if (issue.type === 'warning') {
                      doc.setTextColor(234, 179, 8);
                  } else if (issue.type === 'suggestion') {
                      doc.setTextColor(59, 130, 246);
                  } else {
                      doc.setTextColor(50, 50, 50);
                  }

                  const issueTitle = `${issue.type === 'error' ? '✗' : issue.type === 'warning' ? '⚠' : 'ℹ'} ${issue.title} (${issueScore.toFixed(1)}/10)`;
                  doc.text(issueTitle, margin + 5, yPos);
                  yPos += 6;

                  doc.setFont(undefined, 'normal');
                  doc.setTextColor(100, 100, 100);
                  const descLines = doc.splitTextToSize(issue.description, pageWidth - 2 * margin - 10);
                  doc.text(descLines, margin + 5, yPos);
                  yPos += descLines.length * 5 + 5;
              });
          }
          yPos += 5;
      });

      // 保存PDF
      const fileName = lang === 'zh' 
        ? `${robot.name}_检查报告_${dateStr.replace(/[\/\s:]/g, '_')}.pdf`
        : `${robot.name}_inspection_report_${dateStr.replace(/[\/\s:]/g, '_')}.pdf`;
      doc.save(fileName);
  };

  const renderInspectionReport = () => {
      if (!inspectionReport) return null;

      const overallScore = inspectionReport.overallScore ?? 0;
      const maxScore = inspectionReport.maxScore ?? 100;
      const scorePercentage = (overallScore / maxScore) * 100;

      // 根据分数确定颜色（6分以下红色，6-9黄色，9以上绿色）
      // 注意：这是针对10分制的单项得分，总分需要按比例计算
      const getScoreColor = (score: number, maxScoreForItem: number = 10) => {
        const normalizedScore = (score / maxScoreForItem) * 10; // 归一化到10分制
        if (normalizedScore >= 9) return 'text-green-600 dark:text-green-400';
        if (normalizedScore >= 6) return 'text-yellow-600 dark:text-yellow-400';
        return 'text-red-600 dark:text-red-400';
      };

      const getScoreBgColor = (score: number, maxScoreForItem: number = 10) => {
        const normalizedScore = (score / maxScoreForItem) * 10; // 归一化到10分制
        if (normalizedScore >= 9) return 'bg-green-500';
        if (normalizedScore >= 6) return 'bg-yellow-500';
        return 'bg-red-500';
      };

      // 按章节分组 issues
      const issuesByCategory: Record<string, typeof inspectionReport.issues> = {};
      INSPECTION_CRITERIA.forEach(category => {
        issuesByCategory[category.id] = [];
      });

      inspectionReport.issues.forEach(issue => {
        const categoryId = issue.category || 'physical';
        if (!issuesByCategory[categoryId]) {
          issuesByCategory[categoryId] = [];
        }
        issuesByCategory[categoryId].push(issue);
      });

      const toggleCategory = (categoryId: string) => {
        setExpandedCategories(prev => {
          const newSet = new Set(prev);
          if (newSet.has(categoryId)) {
            newSet.delete(categoryId);
          } else {
            newSet.add(categoryId);
          }
          return newSet;
        });
      };

      return (
          <div className="space-y-4">
               {/* 总分显示和下载按钮 */}
               <div className="bg-gradient-to-r from-slate-100 dark:from-slate-800/80 to-slate-200 dark:to-slate-900/80 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold">{t.overallScore}</div>
                        <div className="flex items-center gap-3">
                            <div className={`text-2xl font-bold ${getScoreColor(overallScore, maxScore)}`}>
                                {overallScore.toFixed(1)}/{maxScore}
                            </div>
                            <button
                                onClick={handleDownloadPDF}
                                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm transition-colors"
                                title={t.downloadReportPDF}
                            >
                                <FileText className="w-4 h-4" />
                                <span className="text-xs">{t.downloadReport}</span>
                            </button>
                        </div>
                    </div>
                    {/* 进度条 */}
                    <div className="w-full h-2 bg-slate-300 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div 
                            className={`h-full transition-all duration-500 ${getScoreBgColor(overallScore, maxScore)}`}
                            style={{ width: `${scorePercentage}%` }}
                        />
                    </div>
               </div>

               {/* 总结 */}
               <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded border border-slate-200 dark:border-slate-700">
                    <div className="text-xs text-slate-500 uppercase font-bold mb-1">{t.inspectorSummary}</div>
                    <div className="text-sm text-slate-700 dark:text-slate-300 font-medium">{inspectionReport.summary}</div>
               </div>

               {/* 按章节分组展示 */}
               <div className="space-y-2">
                   {INSPECTION_CRITERIA.map(category => {
                       const categoryIssues = issuesByCategory[category.id] || [];
                       const categoryScore = inspectionReport.categoryScores?.[category.id] ?? 10;
                       const isExpanded = expandedCategories.has(category.id);
                       const categoryName = lang === 'zh' ? category.nameZh : category.name;

                       // 获取该章节下所有条目的得分
                       const itemScores = categoryIssues.map(issue => issue.score ?? 10);
                       const avgScore = itemScores.length > 0 
                           ? itemScores.reduce((a, b) => a + b, 0) / itemScores.length 
                           : 10;

                       return (
                           <div key={category.id} className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                               {/* 章节标题栏 */}
                               <button
                                   onClick={() => toggleCategory(category.id)}
                                   className="w-full flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-800/70 transition-colors"
                               >
                                   <div className="flex items-center gap-2">
                                       {isExpanded ? (
                                           <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                                       ) : (
                                           <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                                       )}
                                       <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{categoryName}</span>
                                       <span className="text-xs text-slate-500 dark:text-slate-400">({category.weight * 100}%)</span>
                                   </div>
                                   <div className="flex items-center gap-2">
                                       <span className={`text-sm font-bold ${getScoreColor(categoryScore)}`}>
                                           {categoryScore.toFixed(1)}/10
                                       </span>
                                       <div className="w-16 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full overflow-hidden">
                                           <div 
                                               className={`h-full ${getScoreBgColor(categoryScore)}`}
                                               style={{ width: `${(categoryScore / 10) * 100}%` }}
                                           />
                                       </div>
                                   </div>
                               </button>

                               {/* 章节内容 */}
                               {isExpanded && (
                                   <div className="p-3 bg-slate-50 dark:bg-slate-900/30 space-y-2">
                                       {categoryIssues.length === 0 ? (
                                           <div className="flex items-center gap-2 p-2 bg-green-100 dark:bg-green-900/20 border border-green-300 dark:border-green-700/30 rounded text-green-600 dark:text-green-300 text-xs">
                                               <Check className="w-3 h-3" />
                                               <span>{lang === 'zh' ? '✓ 该章节所有检查项均通过' : 'All checks passed for this category'}</span>
                                           </div>
                                       ) : (
                                           categoryIssues.map((issue, idx) => {
                                               const issueScore = issue.score ?? 10;
                                               let colorClass = "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300";
                                               let icon = <Info className="w-4 h-4" />;
                                               let titleColor = "text-slate-700 dark:text-slate-200";

                                               if (issue.type === 'error') {
                                                   colorClass = "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50";
                                                   icon = <AlertCircle className="w-4 h-4 text-red-500" />;
                                                   titleColor = "text-red-600 dark:text-red-300";
                                               } else if (issue.type === 'warning') {
                                                   colorClass = "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50";
                                                   icon = <AlertTriangle className="w-4 h-4 text-amber-500" />;
                                                   titleColor = "text-amber-600 dark:text-amber-300";
                                               } else if (issue.type === 'suggestion') {
                                                   colorClass = "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50";
                                                   icon = <Sparkles className="w-4 h-4 text-blue-500" />;
                                                   titleColor = "text-blue-600 dark:text-blue-300";
                                               } else if (issue.type === 'pass') {
                                                   colorClass = "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50";
                                                   icon = <Check className="w-4 h-4 text-green-500" />;
                                                   titleColor = "text-green-600 dark:text-green-300";
                                               }

                                               const isRetesting = retestingItem?.categoryId === issue.category && retestingItem?.itemId === issue.itemId;
                                               
                                               return (
                                                   <div key={idx} className={`p-3 rounded border flex gap-3 ${colorClass}`}>
                                                       <div className="mt-0.5 shrink-0">{icon}</div>
                                                       <div className="flex-1">
                                                           <div className="flex items-center justify-between mb-1">
                                                               <div className={`text-sm font-bold ${titleColor}`}>{issue.title}</div>
                                                               <div className="flex items-center gap-2">
                                                                   <div className={`text-xs font-bold ${getScoreColor(issueScore)}`}>
                                                                       {issueScore.toFixed(1)}/10
                                                                   </div>
                                                                   {issue.category && issue.itemId && issue.type !== 'pass' && (
                                                                       <button
                                                                           onClick={() => handleRetestItem(issue.category!, issue.itemId!)}
                                                                           disabled={isRetesting || isGeneratingAI}
                                                                           className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-[10px] rounded transition-colors disabled:opacity-50 flex items-center gap-1"
                                                                           title={t.retestItem}
                                                                       >
                                                                           {isRetesting ? (
                                                                               <Loader2 className="w-3 h-3 animate-spin" />
                                                                           ) : (
                                                                               <RefreshCw className="w-3 h-3" />
                                                                           )}
                                                                       </button>
                                                                   )}
                                                               </div>
                                                           </div>
                                                           <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{issue.description}</div>
                                                           {issue.relatedIds && issue.relatedIds.length > 0 && (
                                                               <div className="flex flex-wrap gap-1 mt-2">
                                                                   {issue.relatedIds.map(id => {
                                                                       const name = robot.links[id]?.name || robot.joints[id]?.name || id;
                                                                       return (
                                                                        <span 
                                                                            key={id} 
                                                                            className="text-[10px] bg-slate-200 dark:bg-slate-900/50 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700/50 cursor-pointer hover:bg-slate-300 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white"
                                                                            onClick={() => {
                                                                                const type = robot.links[id] ? 'link' : 'joint';
                                                                                handleSelect(type, id);
                                                                            }}
                                                                        >
                                                                            {name}
                                                                        </span>
                                                                       );
                                                                   })}
                                                               </div>
                                                           )}
                                                       </div>
                                                   </div>
                                               );
                                           })
                                       )}
                                   </div>
                               )}
                           </div>
                       );
                   })}
               </div>
          </div>
      );
  };

  return (
    <div className="flex flex-col h-screen font-sans bg-google-light-bg dark:bg-google-dark-bg text-slate-800 dark:text-slate-200">
      <input 
        type="file" 
        accept=".zip,.urdf,.xml,.usda,.usd" 
        ref={importInputRef} 
        onChange={handleImport} 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={importFolderInputRef}
        onChange={handleImport} 
        className="hidden"
        {...{ webkitdirectory: "", directory: "" } as any}
      />

      {/* Header */}
      <header className="h-12 border-b flex items-center justify-between px-3 shrink-0 relative bg-white dark:bg-[#1a1d21] border-slate-200/80 dark:border-slate-700/50">
        {/* Left Section - Logo & Menus */}
        <div className="flex items-center gap-1">
            {/* Logo */}
            <div className="flex items-center gap-2 pr-3 mr-1 border-r border-slate-200 dark:border-slate-700/50">
                <img src="/logo.png" alt="Logo" className="w-7 h-7 object-contain" />
            </div>
            
            {/* Menu Buttons */}
            <div className="flex items-center">
                <div className="relative">
                    <button 
                        onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${activeMenu === 'file' ? 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'}`}
                    >
                        <FileText className="w-3.5 h-3.5" />
                        {t.file}
                        <ChevronDown className={`w-3 h-3 opacity-60 transition-transform ${activeMenu === 'file' ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {activeMenu === 'file' && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setActiveMenu(null)} />
                            <div className="absolute top-full left-0 mt-1 w-52 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden py-1">
                                <button
                                    onClick={() => { setActiveMenu(null); setTimeout(() => importFolderInputRef.current?.click(), 0); }}
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 flex items-center gap-2.5"
                                >
                                    <Folder className="w-4 h-4 text-slate-400" />
                                    {t.importFolder}
                                </button>
                                <button
                                    onClick={() => { setActiveMenu(null); setTimeout(() => importInputRef.current?.click(), 0); }}
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 flex items-center gap-2.5"
                                >
                                    <Download className="w-4 h-4 text-slate-400" />
                                    {lang === 'zh' ? '导入 ZIP / 文件' : 'Import ZIP / File'}
                                </button>
                                <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
                                <button
                                    onClick={() => { setActiveMenu(null); handleExport(); }}
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 flex items-center gap-2.5"
                                >
                                    <Upload className="w-4 h-4 text-slate-400" />
                                    {t.export}
                                </button>
                            </div>
                        </>
                    )}
                </div>

                <div className="relative">
                    <button 
                        onClick={() => setActiveMenu(activeMenu === 'toolbox' ? null : 'toolbox')}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${activeMenu === 'toolbox' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'}`}
                    >
                        <Briefcase className="w-3.5 h-3.5" />
                        {t.toolbox}
                        <ChevronDown className={`w-3 h-3 opacity-60 transition-transform ${activeMenu === 'toolbox' ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {activeMenu === 'toolbox' && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setActiveMenu(null)} />
                            <div className="absolute top-full left-0 mt-1 w-[280px] bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 z-50 p-2">
                                <div className="space-y-1">
                                    <button
                                        onClick={() => {
                                            setActiveMenu(null);
                                            setIsAIModalOpen(true);
                                            setAiResponse(null); setInspectionReport(null); setAiPrompt('');
                                            setInspectionProgress(null); setReportGenerationTimer(null);
                                        }}
                                        className="w-full flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all group"
                                    >
                                        <div className="w-9 h-9 flex items-center justify-center bg-purple-100 dark:bg-purple-900/40 rounded-lg text-purple-600 dark:text-purple-400 shrink-0">
                                            <ScanSearch className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1 text-left">
                                            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{t.aiAssistant}</div>
                                            <div className="text-[10px] text-slate-400 dark:text-slate-500">{t.aiAssistantDesc}</div>
                                        </div>
                                    </button>
                                    
                                    <button
                                        onClick={() => {
                                            setActiveMenu(null);
                                            window.open('https://motion-tracking.axell.top/', '_blank');
                                        }}
                                        className="w-full flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all group"
                                    >
                                        <div className="w-9 h-9 flex items-center justify-center bg-blue-100 dark:bg-blue-900/40 rounded-lg text-blue-600 dark:text-blue-400 shrink-0">
                                            <RefreshCw className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1 text-left">
                                            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{t.robotRedirect}</div>
                                            <div className="text-[10px] text-slate-400 dark:text-slate-500">{t.motionTrackingDesc}</div>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => { setActiveMenu(null); window.open('https://motion-editor.cyoahs.dev/', '_blank'); }}
                                        className="w-full flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-green-50 dark:hover:bg-green-900/20 transition-all group"
                                    >
                                        <div className="w-9 h-9 flex items-center justify-center bg-green-100 dark:bg-green-900/40 rounded-lg text-green-600 dark:text-green-400 shrink-0">
                                            <Activity className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1 text-left">
                                            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{t.trajectoryEditing}</div>
                                            <div className="text-[10px] text-slate-400 dark:text-slate-500">{t.trajectoryEditingDesc}</div>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setActiveMenu(null);
                                            window.open('https://engine.bridgedp.com/', '_blank');
                                        }}
                                        className="w-full flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all group"
                                    >
                                        <div className="w-9 h-9 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 p-1.5 shrink-0">
                                            <img src="/bridgedp-logo.png" alt="BridgeDP" className="w-full h-full object-contain" />
                                        </div>
                                        <div className="flex-1 text-left">
                                            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{t.bridgedpEngine}</div>
                                            <div className="text-[10px] text-slate-400 dark:text-slate-500">{t.bridgedpEngineDesc}</div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="relative">
                    <button 
                        onClick={() => setIsCodeViewerOpen(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                    >
                        <Code className="w-3.5 h-3.5" />
                        {lang === 'zh' ? '源代码' : 'Source Code'}
                    </button>
                </div>

                <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1.5" />

                <div className="flex items-center gap-0.5">
                    <button 
                        onClick={undo}
                        disabled={!canUndo}
                        className={`p-1.5 rounded-md transition-all ${!canUndo ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'}`}
                        title={lang === 'zh' ? "撤销 (Ctrl+Z)" : "Undo (Ctrl+Z)"}
                    >
                        <Undo className="w-4 h-4" />
                    </button>
                    <button 
                        onClick={redo}
                        disabled={!canRedo}
                        className={`p-1.5 rounded-md transition-all ${!canRedo ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'}`}
                        title={lang === 'zh' ? "重做 (Ctrl+Shift+Z)" : "Redo (Ctrl+Shift+Z)"}
                    >
                        <Redo className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>

        {/* Center - Mode Switcher */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
                <button 
                    onClick={() => setAppMode('skeleton')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${appMode === 'skeleton' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                    <Activity className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t.skeleton}</span>
                </button>
                <button 
                    onClick={() => setAppMode('detail')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${appMode === 'detail' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                    <Box className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t.detail}</span>
                </button>
                <button 
                    onClick={() => setAppMode('hardware')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${appMode === 'hardware' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                    <Cpu className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t.hardware}</span>
                </button>
            </div>
        </div>

        {/* Right Section - Actions */}
        <div className="flex items-center gap-0.5">
            <button 
                onClick={() => setLang(prev => prev === 'en' ? 'zh' : 'en')}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-all"
                title={lang === 'zh' ? "切换语言" : "Switch Language"}
            >
                <Globe className="w-3.5 h-3.5" />
                <span className="text-[10px] font-semibold">{lang === 'en' ? 'EN' : '中'}</span>
            </button>

            <button
                onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
                className="flex items-center justify-center w-8 h-8 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-all"
                title={lang === 'zh' ? "切换主题" : "Toggle Theme"}
            >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

            <button 
                onClick={() => setIsAboutMenuOpen(true)}
                className="flex items-center justify-center w-8 h-8 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-all"
                title={lang === 'zh' ? "关于" : "About"}
            >
                <Info className="w-4 h-4" />
            </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        <TreeEditor 
            robot={robot} 
            onSelect={handleSelect} 
            onFocus={handleFocus}
            onAddChild={handleAddChild}
            onDelete={handleDelete}
            onNameChange={handleNameChange}
            mode={appMode}
            lang={lang}
            theme={theme}
            collapsed={leftSidebarCollapsed}
            onToggle={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
        />
        
        {(appMode === 'detail' || appMode === 'hardware') && urdfContentForViewer ? (
            <URDFViewer
                urdfContent={urdfContentForViewer}
                assets={assets}
                lang={lang}
                mode={appMode}
                onSelect={handleSelect}
                selection={robot.selection}
                hoveredSelection={hoveredSelection}
                focusTarget={focusTarget}
                theme={theme}
                robotLinks={robot.links}
                onCollisionTransform={(linkId, position, rotation) => {
                    // linkId is the selection.id which is the link's ID (not name)
                    console.log('App.tsx onCollisionTransform called:', { linkId, position, rotation });
                    console.log('Available links:', Object.keys(robot.links));
                    
                    if (linkId && robot.links[linkId]) {
                        const link = robot.links[linkId];
                        console.log('Found link, updating collision origin:', link.name);
                        
                        const updatedLink = {
                            ...link,
                            collision: {
                                ...link.collision,
                                origin: {
                                    xyz: position,
                                    rpy: rotation
                                }
                            }
                        };
                        console.log('Updated link data:', updatedLink);
                        handleUpdate('link', linkId, updatedLink);
                    } else {
                        console.warn('Link not found for ID:', linkId);
                    }
                }}
            />
        ) : (
            <Visualizer 
                robot={robot} 
                onSelect={handleSelect}
                onUpdate={handleUpdate}
                mode={appMode}
                assets={assets}
                lang={lang}
                theme={theme}
                os={os}
            />
        )}
        
        <PropertyEditor 
            robot={robot} 
            onUpdate={handleUpdate}
            onSelect={handleSelect}
            onHover={(type, id, subType) => setHoveredSelection({ type, id, subType })}
            mode={appMode}
            assets={assets}
            onUploadAsset={handleUploadAsset}
            motorLibrary={motorLibrary}
            lang={lang}
            theme={theme}
            collapsed={rightSidebarCollapsed}
            onToggle={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
        />
      </div>

      {/* Source Code Editor Window */}
      {isCodeViewerOpen && (
        <SourceCodeEditor
            code={generateURDF(robot)}
            onCodeChange={handleCodeChange}
            onClose={() => setIsCodeViewerOpen(false)}
            theme={theme}
            fileName={`${robot.name}.urdf`}
            lang={lang}
        />
      )}

      {/* AI Inspector Floating Window */}
            {isAIModalOpen && (
                    <div 
                        style={{ left: aiPanelPos.x, top: aiPanelPos.y }}
                        className="fixed z-50 w-[720px] h-[560px] flex flex-col bg-slate-100 dark:bg-[#181c20] backdrop-blur-md shadow-2xl rounded-lg border border-slate-300 dark:border-slate-700"
                    >
                            <div 
                                onMouseDown={handleDragStart}
                                className="flex items-center justify-between p-2 border-b border-slate-200 dark:border-slate-700 shrink-0 cursor-move bg-slate-200/80 dark:bg-[#23272b] rounded-t-lg select-none"
                            >
                  <div className="flex items-center gap-2">
                      <ScanSearch className="w-4 h-4 text-purple-600 dark:text-purple-300" />
                      <h2 className="text-sm font-bold text-slate-800 dark:text-white">{t.aiTitle}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                     <Move className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                     <button onClick={() => { setIsAIModalOpen(false); setInspectionProgress(null); setReportGenerationTimer(null); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                        <X className="w-4 h-4" />
                     </button>
                  </div>
              </div>
              
              <div className="flex flex-1 overflow-hidden bg-white dark:bg-[#181c20]">
                  {/* 左侧：检查项目选择器和运行按钮 */}
                  <div className="w-52 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-slate-50/30 dark:bg-[#23272b]">
                      <div className="p-2 border-b border-slate-200 dark:border-slate-700">
                          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-300 uppercase mb-1.5">{t.inspectionItems}</h3>
                          <button
                              onClick={handleRunInspection}
                              disabled={isGeneratingAI}
                              className="w-full py-1.5 bg-slate-800 dark:bg-[#23272b] hover:bg-slate-700 dark:hover:bg-[#181c20] text-white rounded text-xs flex items-center justify-center gap-1.5 transition-colors border border-slate-700 dark:border-slate-600 disabled:opacity-50"
                          >
                              {isGeneratingAI ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
                              {isGeneratingAI ? t.thinking : t.runInspection}
                          </button>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
                          {INSPECTION_CRITERIA.map(category => {
                              const categoryName = lang === 'zh' ? category.nameZh : category.name;
                              const selectedItemIds = selectedItems[category.id] || new Set();
                              const allSelected = category.items.every(item => selectedItemIds.has(item.id));
                              const someSelected = category.items.some(item => selectedItemIds.has(item.id));
                              
                              return (
                                  <div key={category.id} className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                                      {/* 章节标题 */}
                                      <div className="w-full flex items-center justify-between p-2 bg-slate-100/50 dark:bg-slate-800/50 hover:bg-slate-200/50 dark:hover:bg-slate-800/70 transition-colors">
                                          <div className="flex items-center gap-2 flex-1">
                                              <input
                                                  type="checkbox"
                                                  checked={allSelected}
                                                  ref={(el) => {
                                                      if (el) el.indeterminate = someSelected && !allSelected;
                                                  }}
                                                  onChange={() => toggleCategorySelection(category.id)}
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="rounded border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-700 text-purple-600 focus:ring-purple-500"
                                              />
                                              <button
                                                  onClick={() => {
                                                      setExpandedCategories(prev => {
                                                          const newSet = new Set(prev);
                                                          if (newSet.has(category.id)) {
                                                              newSet.delete(category.id);
                                                          } else {
                                                              newSet.add(category.id);
                                                          }
                                                          return newSet;
                                                      });
                                                  }}
                                                  className="flex-1 text-left"
                                              >
                                                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{categoryName}</span>
                                              </button>
                                          </div>
                                          <button
                                              onClick={() => {
                                                  setExpandedCategories(prev => {
                                                      const newSet = new Set(prev);
                                                      if (newSet.has(category.id)) {
                                                          newSet.delete(category.id);
                                                      } else {
                                                          newSet.add(category.id);
                                                      }
                                                      return newSet;
                                                  });
                                              }}
                                          >
                                              {expandedCategories.has(category.id) ? (
                                                  <ChevronDown className="w-3 h-3 text-slate-400" />
                                              ) : (
                                                  <ChevronRight className="w-3 h-3 text-slate-400" />
                                              )}
                                          </button>
                                      </div>
                                      
                                      {/* 子项列表 */}
                                      {expandedCategories.has(category.id) && (
                                          <div className="p-2 space-y-1 bg-slate-50/50 dark:bg-slate-900/30">
                                              {category.items.map(item => (
                                                  <label
                                                      key={item.id}
                                                      className="flex items-center gap-2 p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded cursor-pointer"
                                                      onClick={(e) => e.stopPropagation()}
                                                  >
                                                      <input
                                                          type="checkbox"
                                                          checked={selectedItemIds.has(item.id)}
                                                          onChange={() => toggleItemSelection(category.id, item.id)}
                                                          className="rounded border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-700 text-purple-600 focus:ring-purple-500"
                                                      />
                                                      <span className="text-[10px] text-slate-600 dark:text-slate-300">{lang === 'zh' ? item.nameZh : item.name}</span>
                                                  </label>
                                              ))}
                                          </div>
                                      )}
                                  </div>
                              );
                          })}
                      </div>
                  </div>
                  
                  {/* 右侧：检查结果 */}
                  <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#181c20]">
                      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                      {inspectionProgress ? (
                          <div className="space-y-4">
                              <div className="bg-slate-100 dark:bg-[#23272b] border border-slate-300 dark:border-slate-700 rounded-lg p-4">
                                  <div className="flex items-center justify-between mb-3">
                                      <h3 className="text-sm font-bold text-purple-700 dark:text-purple-200">{t.runInspection}</h3>
                                      <span className="text-xs text-slate-500 dark:text-slate-400">
                                          {inspectionProgress.completed} / {inspectionProgress.total}
                                      </span>
                                  </div>
                                  <div className="w-full h-2 bg-slate-300 dark:bg-slate-700 rounded-full overflow-hidden mb-3">
                                      <div 
                                          className="h-full bg-slate-800 dark:bg-[#23272b] transition-all duration-300"
                                          style={{ width: `${(inspectionProgress.completed / inspectionProgress.total) * 100}%` }}
                                      />
                                  </div>
                                      {inspectionProgress.currentCategory && inspectionProgress.currentItem && (
                                      <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                          <Loader2 className="w-4 h-4 animate-spin text-purple-500 dark:text-purple-400" />
                                          <span>
                                              {t.checking}: <span className="font-bold text-purple-600 dark:text-purple-300">{inspectionProgress.currentCategory}</span> - <span className="text-slate-500 dark:text-slate-400">{inspectionProgress.currentItem}</span>
                                          </span>
                                      </div>
                                  )}
                                  {inspectionProgress.completed === inspectionProgress.total && (
                                      <div className="space-y-2">
                                          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                                              <Check className="w-4 h-4" />
                                              <span>{t.inspectionCompleted}</span>
                                          </div>
                                          {reportGenerationTimer !== null && (
                                              <div className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                                                  <Loader2 className="w-4 h-4 animate-spin text-slate-800 dark:text-slate-200" />
                                                  <span>
                                                      {t.generatingReport} ({reportGenerationTimer}s)
                                                  </span>
                                              </div>
                                          )}
                                      </div>
                                  )}
                              </div>
                              <div className="space-y-2">
                                  {INSPECTION_CRITERIA.map(category => {
                                      const categoryName = lang === 'zh' ? category.nameZh : category.name;
                                      const selectedItemIds = selectedItems[category.id] || new Set();
                                      const categoryItems = category.items.filter(item => selectedItemIds.has(item.id));
                                      if (categoryItems.length === 0) return null;
                                      return (
                                          <div key={category.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-slate-50 dark:bg-[#23272b]">
                                              <div className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-2">{categoryName}</div>
                                              <div className="space-y-1">
                                                  {categoryItems.map((item, idx) => {
                                                      const globalIndex = (() => {
                                                          let count = 0;
                                                          for (const cat of INSPECTION_CRITERIA) {
                                                              if (cat.id === category.id) break;
                                                              const items = cat.items.filter(i => selectedItems[cat.id]?.has(i.id));
                                                              count += items.length;
                                                          }
                                                          return count + idx;
                                                      })();
                                                      const itemName = lang === 'zh' ? item.nameZh : item.name;
                                                      const isCurrent = inspectionProgress.completed === globalIndex + 1 && 
                                                                       inspectionProgress.currentItem === itemName;
                                                      const isCompleted = inspectionProgress.completed > globalIndex + 1;
                                                      return (
                                                          <div 
                                                              key={item.id}
                                                              className={`flex items-center gap-2 p-1.5 rounded text-xs ${
                                                                      isCurrent ? 'bg-slate-200 dark:bg-[#23272b] text-slate-800 dark:text-slate-200' :
                                                                      isCompleted ? 'bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400' :
                                                                      'text-slate-500 dark:text-slate-400'
                                                                  }`}
                                                          >
                                                              {isCurrent ? (
                                                                  <Loader2 className="w-3 h-3 animate-spin" />
                                                              ) : isCompleted ? (
                                                                  <Check className="w-3 h-3" />
                                                              ) : (
                                                                  <div className="w-3 h-3 rounded-full border border-slate-400 dark:border-slate-600" />
                                                              )}
                                                              <span>{itemName}</span>
                                                          </div>
                                                      );
                                                  })}
                                              </div>
                                          </div>
                                      );
                                  })}
                              </div>
                          </div>
                      ) : !aiResponse && !inspectionReport ? (
                          <>
                              <div className="bg-slate-100 dark:bg-[#23272b] border border-slate-300 dark:border-slate-700 rounded p-4 mb-4">
                                <h3 className="text-sm font-bold text-purple-700 dark:text-purple-200 mb-2">{t.runInspection}</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t.aiExamples}</p>
                            </div>

                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3 border-t border-slate-200 dark:border-slate-700 pt-4">
                                {t.aiIntro}
                            </p>
                            
                            <textarea 
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                className="w-full h-24 bg-slate-50 dark:bg-[#23272b] border border-slate-200 dark:border-slate-700 rounded p-3 text-slate-700 dark:text-slate-200 text-sm focus:border-slate-800 dark:focus:border-slate-400 focus:outline-none resize-none"
                                placeholder={t.aiPlaceholder}
                            />
                          </>
                      ) : (
                          <>
                            {inspectionReport && (
                              <div className="relative">
                                {renderInspectionReport()}
                                
                                {/* Chat Dialog - Bottom Right of Report */}
                                {isReportChatOpen && (
                                  <div className="fixed bottom-4 right-4 z-50 w-80 h-[400px] flex flex-col bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-2xl rounded-lg border border-slate-300 dark:border-slate-600">
                                    <div className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-slate-700 shrink-0 bg-slate-100/50 dark:bg-slate-800/50 rounded-t-lg">
                                        <div className="flex items-center gap-2">
                                            <MessageCircle className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                                            <h3 className="text-sm font-bold text-slate-800 dark:text-white">{t.chatTitle}</h3>
                                        </div>
                                      <button
                                        onClick={() => {
                                          setIsReportChatOpen(false);
                                          setReportChatMessages([]);
                                          setReportChatInput('');
                                        }}
                                        className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>

                                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                                      {reportChatMessages.length === 0 ? (
                                        <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
                                          {t.askAboutReport}
                                        </div>
                                      ) : (
                                        reportChatMessages.map((msg, idx) => (
                                          <div
                                            key={idx}
                                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                          >
                                            <div
                                              className={`max-w-[80%] rounded-lg p-3 ${
                                                msg.role === 'user'
                                                  ? 'bg-blue-600 text-white'
                                                  : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                                              }`}
                                            >
                                              <div className="text-xs whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                                            </div>
                                          </div>
                                        ))
                                      )}
                                      {isChatGenerating && (
                                        <div className="flex justify-start">
                                          <div className="bg-slate-200 dark:bg-slate-800 rounded-lg p-3">
                                            <Loader2 className="w-4 h-4 animate-spin text-blue-500 dark:text-blue-400" />
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    <div className="p-3 border-t border-slate-200 dark:border-slate-700 shrink-0">
                                      <div className="flex gap-2">
                                        <input
                                          type="text"
                                          value={reportChatInput}
                                          onChange={(e) => setReportChatInput(e.target.value)}
                                          onKeyPress={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                              e.preventDefault();
                                              handleReportChatSend();
                                            }
                                          }}
                                          placeholder={t.chatPlaceholder}
                                          className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-700 dark:text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                                          disabled={isChatGenerating}
                                        />
                                        <button
                                          onClick={handleReportChatSend}
                                          disabled={isChatGenerating || !reportChatInput.trim()}
                                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition-colors flex items-center gap-2"
                                        >
                                          {isChatGenerating ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                          ) : (
                                            <Send className="w-4 h-4" />
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Chat Button - Bottom Right of Report */}
                                {!isReportChatOpen && (
                                  <button
                                    onClick={() => setIsReportChatOpen(true)}
                                    className="fixed bottom-4 right-4 z-40 w-14 h-14 bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
                                    title={t.chatWithAI}
                                  >
                                    <MessageCircle className="w-6 h-6" />
                                  </button>
                                )}
                              </div>
                            )}
                            
                            {aiResponse && (
                                <div className="space-y-4">
                                      <div className="bg-slate-50 dark:bg-[#23272b] p-3 rounded border border-slate-200 dark:border-slate-700">
                                        <div className="text-xs text-slate-500 uppercase font-bold mb-1">{t.yourRequest}</div>
                                        <div className="text-sm text-slate-700 dark:text-slate-300">{aiPrompt}</div>
                                    </div>
                                    
                                    <div className="bg-slate-100 dark:bg-[#23272b] p-3 rounded border border-slate-300 dark:border-slate-700">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Sparkles className="w-3 h-3 text-slate-800 dark:text-slate-200" />
                                            <div className="text-xs text-slate-800 dark:text-slate-200 uppercase font-bold">
                                                {t.aiResponse} {aiResponse.type ? `(${aiResponse.type})` : ''}
                                            </div>
                                        </div>
                                        <div className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                                            {aiResponse.explanation || t.processing}
                                        </div>
                                    </div>
                                    
                                    {aiResponse.data && (
                                        <div className="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded border border-yellow-300 dark:border-yellow-700/30">
                                            <Box className="w-3 h-3" />
                                            {t.actionWarning}
                                        </div>
                                    )}
                                </div>
                            )}
                          </>
                      )}
                      </div>
                  </div>
              </div>

              <div className="p-3 border-t border-slate-200 dark:border-slate-700 flex justify-between gap-2 shrink-0 bg-slate-100/30 dark:bg-[#23272b] rounded-b-lg">
                  {(aiResponse || inspectionReport) ? (
                      <>
                          <button 
                            onClick={() => { setAiResponse(null); setInspectionReport(null); setAiPrompt(''); setInspectionProgress(null); setReportGenerationTimer(null); }}
                            className="px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
                          >
                            {t.back}
                          </button>
                          {aiResponse?.data && (
                            <button 
                                onClick={applyAIChanges}
                                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs rounded transition-colors flex items-center gap-2"
                            >
                                <Check className="w-3 h-3" />
                                {t.applyChanges}
                            </button>
                          )}
                      </>
                  ) : (
                      <>
                        <button 
                            onClick={() => { setIsAIModalOpen(false); setInspectionProgress(null); setReportGenerationTimer(null); }}
                            className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#23272b] rounded transition-colors"
                        >
                            {t.cancel}
                        </button>
                        <button 
                            onClick={handleGenerateAI}
                            disabled={isGeneratingAI || !aiPrompt.trim()}
                            className="px-3 py-1.5 bg-slate-800 dark:bg-[#23272b] hover:bg-slate-700 dark:hover:bg-[#181c20] disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs rounded transition-colors flex items-center gap-2 border border-slate-700 dark:border-slate-600"
                        >
                            {isGeneratingAI ? (
                                <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    {t.thinking}
                                </>
                            ) : (
                                <>
                                    <ArrowRight className="w-3 h-3" />
                                    {t.send}
                                </>
                            )}
                        </button>
                      </>
                  )}
              </div>
          </div>
      )}

      {/* About Modal */}
      {isAboutMenuOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
              <div 
                  className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                  onClick={() => setIsAboutMenuOpen(false)}
              />
              <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-[400px] overflow-hidden">
                  {/* Header */}
                  <div className="bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 px-6 py-5 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                              <img src="/logo.png" alt="URDF Studio" className="w-10 h-10 object-contain" />
                              <div>
                                  <h2 className="text-lg font-bold text-slate-800 dark:text-white">URDF Studio</h2>
                                  <p className="text-xs text-slate-500 dark:text-slate-400">v1.0.0</p>
                              </div>
                          </div>
                          <button 
                              onClick={() => setIsAboutMenuOpen(false)}
                              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                          >
                              <X className="w-4 h-4" />
                          </button>
                      </div>
                  </div>
                  
                  {/* Content */}
                  <div className="p-6 space-y-4">
                      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                          {lang === 'zh' 
                              ? '专业的机器人 URDF 设计与可视化工作站，支持快速编辑，碰撞优化，参数配置，AI审阅和实用工具。' 
                              : 'Professional robot URDF design and visualization workstation, supporting fast editing, collision optimization, parameter configuration, AI review and utility tools.'}
                      </p>
                      
                      {/* Links */}
                      <div className="space-y-2">
                          <a 
                              href="https://github.com/OpenLegged/URDF-Studio"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
                          >
                              <div className="w-9 h-9 bg-slate-900 dark:bg-slate-700 rounded-lg flex items-center justify-center">
                                  <Github className="w-4 h-4 text-white" />
                              </div>
                              <div className="flex-1">
                                  <div className="text-sm font-medium text-slate-800 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">GitHub</div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400">OpenLegged/URDF-Studio</div>
                              </div>
                              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
                          </a>
                          
                          <a 
                              href="https://www.d-robotics.cc/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
                          >
                              <div className="w-9 h-9 bg-white dark:bg-slate-700 rounded-lg flex items-center justify-center overflow-hidden border border-slate-100 dark:border-slate-600">
                                  <img src="/d-robotics-logo.jpg" alt="D-Robotics" className="w-full h-full object-cover" />
                              </div>
                              <div className="flex-1">
                                  <div className="text-sm font-medium text-slate-800 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
                                      {lang === 'zh' ? '地瓜机器人' : 'D-Robotics'}
                                  </div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400">
                                      {lang === 'zh' ? '感谢支持' : 'Thanks for support'}
                                  </div>
                              </div>
                              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all" />
                          </a>

                          <a 
                              href="https://engine.bridgedp.com/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
                          >
                              <div className="w-9 h-9 bg-white dark:bg-slate-700 rounded-lg flex items-center justify-center overflow-hidden border border-slate-100 dark:border-slate-600">
                                  <img src="/bridgedp-logo.png" alt="BridgeDP" className="w-full h-full object-contain p-1" />
                              </div>
                              <div className="flex-1">
                                  <div className="text-sm font-medium text-slate-800 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                      {lang === 'zh' ? '桥介引擎' : 'Bridgedp Engine'}
                                  </div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400">
                                      {lang === 'zh' ? '感谢支持' : 'Thanks for support'}
                                  </div>
                              </div>
                              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
                          </a>
                      </div>
                  </div>
                  
                  {/* Footer */}
                  <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700">
                      <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                          {lang === 'zh' 
                              ? '© 2025 OpenLegged. 基于 MIT 协议开源。' 
                              : '© 2025 OpenLegged. Open sourced under MIT License.'}
                      </p>
                  </div>
              </div>
          </div>
      )}

      {/* Toast Notification */}
      {toast.show && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="bg-white dark:bg-slate-800 shadow-xl rounded-lg border border-green-200 dark:border-green-900 px-4 py-3 flex items-center gap-3 max-w-md">
                  <div className="bg-green-100 dark:bg-green-900/30 p-1.5 rounded-full shrink-0">
                      <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="text-sm text-slate-700 dark:text-slate-200 font-medium">
                      {toast.message}
                  </div>
                  <button 
                      onClick={() => setToast(prev => ({ ...prev, show: false }))}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-2"
                  >
                      <X className="w-4 h-4" />
                  </button>
              </div>
          </div>
      )}

    </div>
  );
}
