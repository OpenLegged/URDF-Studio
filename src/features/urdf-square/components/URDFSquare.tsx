import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  X, LayoutGrid, Search, Box, User, Heart, Download,
  Star, Clock, Globe, Loader2,
  Minimize2, Maximize2, Minus
} from 'lucide-react';
import { RobotThumbnail3D } from './RobotThumbnail3D';
import { translations } from '@/shared/i18n';

interface URDFSquareProps {
  onClose: () => void;
  lang: 'en' | 'zh';
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

interface RobotModel {
  id: string;
  name: string;
  author: string;
  description: string;
  thumbnail: string;
  category: string;
  stars: number;
  downloads: number;
  tags: string[];
  lastUpdated: string;
  urdfPath?: string;
  urdfFile?: string;
  previewVideo?: string;
  sourceType: 'server' | 'url';
}

interface ModelTranslation {
  name_zh: string;
  description_zh: string;
  tags_zh: string[];
}

const MODEL_TRANSLATIONS: Record<string, ModelTranslation> = {
  'go2': { name_zh: 'Unitree Go2 四足机器人', description_zh: '高性能四足机器人，适用于科研和娱乐场景。', tags_zh: ['科研', '四足', '移动'] },
  'go1': { name_zh: 'Unitree Go1 四足机器人', description_zh: '消费级四足机器人，适合教育和入门研究。', tags_zh: ['教育', '四足', '入门'] },
  'g1': { name_zh: 'Unitree G1 人形机器人', description_zh: '通用人形机器人，适用于教育和科研。', tags_zh: ['人形', '双足', '科研'] },
  'h1': { name_zh: 'Unitree H1 人形机器人', description_zh: '高性能人形机器人，适用于高级研究。', tags_zh: ['人形', '高性能', '科研'] },
  'h1_2': { name_zh: 'Unitree H1 2.0 人形机器人', description_zh: '第二代高性能人形机器人。', tags_zh: ['人形', '双足', '新一代'] },
  'a1': { name_zh: 'Unitree A1 四足机器人', description_zh: '敏捷四足机器人，适合动态运动研究。', tags_zh: ['科研', '四足', '敏捷'] },
  'b1': { name_zh: 'Unitree B1 四足机器人', description_zh: '工业级四足机器人，适用于巡检任务。', tags_zh: ['工业', '四足', '巡检'] },
  'b2': { name_zh: 'Unitree B2 四足机器人', description_zh: '新一代工业四足机器人。', tags_zh: ['工业', '四足', '巡检'] },
  'aliengo': { name_zh: 'Unitree Aliengo 四足机器人', description_zh: '中型四足机器人，适用于多种场景。', tags_zh: ['科研', '四足', '通用'] },
  'z1': { name_zh: 'Unitree Z1 机械臂', description_zh: '轻量级协作机械臂。', tags_zh: ['机械臂', '协作', '轻量'] },
};

const ROBOT_MODELS: RobotModel[] = [
  {
    id: 'go2',
    name: 'Unitree Go2',
    author: 'Unitree Robotics',
    description: 'High-performance quadruped robot for research and entertainment.',
    thumbnail: '/library/urdf/unitree/go2_description/urdf/Normal_collision_model.png',
    category: 'Quadruped',
    stars: 1250,
    downloads: 3200,
    tags: ['Research', 'Quadruped', 'Mobile'],
    lastUpdated: '2026-01-17',
    urdfPath: '/library/urdf/unitree/go2_description',
    sourceType: 'server'
  },
  {
    id: 'go1',
    name: 'Unitree Go1',
    author: 'Unitree Robotics',
    description: 'Consumer-grade quadruped robot for education and beginner research.',
    thumbnail: '',
    category: 'Quadruped',
    stars: 980,
    downloads: 2100,
    tags: ['Education', 'Quadruped', 'Beginner'],
    lastUpdated: '2026-01-15',
    urdfPath: '/library/urdf/unitree/go1_description',
    sourceType: 'server'
  },
  {
    id: 'g1',
    name: 'Unitree G1',
    author: 'Unitree Robotics',
    description: 'General-purpose humanoid robot for education and research.',
    thumbnail: '/library/urdf/unitree/g1_description/thumbnail.png',
    category: 'Humanoid',
    stars: 2100,
    downloads: 4500,
    tags: ['Humanoid', 'Bipedal', 'Research'],
    lastUpdated: '2026-01-17',
    urdfPath: '/library/urdf/unitree/g1_description',
    urdfFile: 'g1_29dof_with_hand.urdf',
    sourceType: 'server'
  },
  {
    id: 'h1',
    name: 'Unitree H1',
    author: 'Unitree Robotics',
    description: 'High-performance humanoid robot for advanced research.',
    thumbnail: '/library/urdf/unitree/h1_description/thumbnail.png',
    category: 'Humanoid',
    stars: 1800,
    downloads: 3800,
    tags: ['Humanoid', 'High-Performance', 'Research'],
    lastUpdated: '2026-01-16',
    urdfPath: '/library/urdf/unitree/h1_description',
    sourceType: 'server'
  },
  {
    id: 'h1_2',
    name: 'Unitree H1 2.0',
    author: 'Unitree Robotics',
    description: 'Second generation high-performance humanoid robot.',
    thumbnail: '/library/urdf/unitree/h1_2_description/thumbnail.png',
    category: 'Humanoid',
    stars: 1500,
    downloads: 2800,
    tags: ['Humanoid', 'Bipedal', 'Next-Gen'],
    lastUpdated: '2026-01-18',
    urdfPath: '/library/urdf/unitree/h1_2_description',
    sourceType: 'server'
  },
  {
    id: 'a1',
    name: 'Unitree A1',
    author: 'Unitree Robotics',
    description: 'Agile quadruped robot for dynamic motion research.',
    thumbnail: '/library/urdf/unitree/a1_description/meshes/trunk_A1.png',
    category: 'Quadruped',
    stars: 1100,
    downloads: 2500,
    tags: ['Research', 'Quadruped', 'Agile'],
    lastUpdated: '2026-01-14',
    urdfPath: '/library/urdf/unitree/a1_description',
    sourceType: 'server'
  },
  {
    id: 'b1',
    name: 'Unitree B1',
    author: 'Unitree Robotics',
    description: 'Industrial-grade quadruped robot for inspection tasks.',
    thumbnail: '',
    category: 'Quadruped',
    stars: 750,
    downloads: 1800,
    tags: ['Industrial', 'Quadruped', 'Inspection'],
    lastUpdated: '2026-01-12',
    urdfPath: '/library/urdf/unitree/b1_description',
    sourceType: 'server'
  },
  {
    id: 'b2',
    name: 'Unitree B2',
    author: 'Unitree Robotics',
    description: 'Next-generation industrial quadruped robot.',
    thumbnail: '/library/urdf/unitree/b2_description_mujoco/Screenshot from 2023-12-11 21-44-55.png',
    category: 'Quadruped',
    stars: 890,
    downloads: 2000,
    tags: ['Industrial', 'Quadruped', 'Inspection'],
    lastUpdated: '2026-01-13',
    urdfPath: '/library/urdf/unitree/b2_description',
    sourceType: 'server'
  },
  {
    id: 'aliengo',
    name: 'Unitree Aliengo',
    author: 'Unitree Robotics',
    description: 'Medium-sized quadruped robot for various applications.',
    thumbnail: '/library/urdf/unitree/aliengo_description/meshes/trunk_uv_base_final.png',
    category: 'Quadruped',
    stars: 650,
    downloads: 1500,
    tags: ['Research', 'Quadruped', 'General'],
    lastUpdated: '2026-01-10',
    urdfPath: '/library/urdf/unitree/aliengo_description',
    sourceType: 'server'
  },
];

const CATEGORIES = [
  { id: 'all', icon: Box },
  { id: 'Quadruped', icon: Box },
  { id: 'Manipulator', icon: Box },
  { id: 'Humanoid', icon: User },
  { id: 'Mobile', icon: Globe },
];

// Get translated category name
const getCategoryName = (categoryId: string, t: typeof translations['en']) => {
  switch (categoryId) {
    case 'all': return t.allModels;
    case 'Quadruped': return t.quadruped;
    case 'Manipulator': return t.manipulators;
    case 'Humanoid': return t.humanoids;
    case 'Mobile': return t.mobileBases;
    default: return categoryId;
  }
};

const RobotThumbnail = ({ model, theme }: { model: RobotModel; theme?: 'light' | 'dark' }) => {
  // Use 3D preview for server-hosted models with urdfPath
  if (model.sourceType === 'server' && model.urdfPath && !model.urdfPath.startsWith('http')) {
    return (
      <RobotThumbnail3D 
        urdfPath={model.urdfPath}
        urdfFile={model.urdfFile}
        theme={theme}
      />
    );
  }

  // Fallback to placeholder for URL-based models
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500 w-full h-full">
      <Box className="w-10 h-10 opacity-40" />
      <span className="text-[9px] uppercase tracking-widest font-medium opacity-60">
        {model.sourceType === 'url' ? 'GitHub' : 'Preview'}
      </span>
    </div>
  );
};

export const URDFSquare: React.FC<URDFSquareProps> = ({ onClose, lang, onImport }) => {
  const t = translations[lang];
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  
  // Detect theme from document class
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');
    
    // Watch for theme changes
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains('dark');
      setTheme(isDark ? 'dark' : 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  
  // Draggable state
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<'right' | 'bottom' | 'corner' | null>(null);
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Center the window on mount
  useEffect(() => {
    const centerX = (window.innerWidth - size.width) / 2;
    const centerY = (window.innerHeight - size.height) / 2;
    setPosition({ x: Math.max(0, centerX), y: Math.max(0, centerY) });
  }, []);

  // Handle mouse down on header for dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  }, [position, isMaximized]);

  // Handle mouse move for dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newX = Math.max(0, Math.min(window.innerWidth - size.width, e.clientX - dragOffset.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 48, e.clientY - dragOffset.y));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, size.width]);

  // Handle resize start
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: 'right' | 'bottom' | 'corner') => {
    if (isMaximized || isMinimized) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height
    };
  }, [isMaximized, isMinimized, size]);

  // Handle mouse move for resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !resizeDirection) return;
      
      const deltaX = e.clientX - resizeStartRef.current.x;
      const deltaY = e.clientY - resizeStartRef.current.y;
      const minWidth = 600;
      const minHeight = 400;
      const maxWidth = window.innerWidth - position.x;
      const maxHeight = window.innerHeight - position.y;
      
      if (resizeDirection === 'right' || resizeDirection === 'corner') {
        const newWidth = Math.max(minWidth, Math.min(maxWidth, resizeStartRef.current.width + deltaX));
        setSize(prev => ({ ...prev, width: newWidth }));
      }
      
      if (resizeDirection === 'bottom' || resizeDirection === 'corner') {
        const newHeight = Math.max(minHeight, Math.min(maxHeight, resizeStartRef.current.height + deltaY));
        setSize(prev => ({ ...prev, height: newHeight }));
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeDirection(null);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeDirection, position.x, position.y]);

  const downloadFromGithub = async (model: RobotModel) => {
    if (!model.urdfPath) return;
    setIsDownloading(true);

    try {
      const url = new URL(model.urdfPath);
      const parts = url.pathname.split('/').filter(Boolean);
      const owner = parts[0];
      const repo = parts[1];
      const branch = parts[3];
      const path = parts.slice(4).join('/');

      if (!(window as any).showDirectoryPicker) {
        throw new Error(lang === 'zh' ? '您的浏览器不支持文件系统访问 API' : 'Your browser does not support File System Access API');
      }
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'downloads'
      });

      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error('GitHub API request failed');
      const contents = await response.json();

      const downloadRecursive = async (items: any[], currentHandle: FileSystemDirectoryHandle) => {
        for (const item of items) {
          if (item.type === 'file') {
            const fileRes = await fetch(item.download_url);
            const blob = await fileRes.blob();
            const fileHandle = await currentHandle.getFileHandle(item.name, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
          } else if (item.type === 'dir') {
            const newDirHandle = await currentHandle.getDirectoryHandle(item.name, { create: true });
            const subDirRes = await fetch(item.url);
            const subDirItems = await subDirRes.json();
            await downloadRecursive(subDirItems, newDirHandle);
          }
        }
      };

      await downloadRecursive(Array.isArray(contents) ? contents : [contents], dirHandle);
      
      setIsDownloading(false);
      if (confirm(lang === 'zh' ? '下载完成！是否立即从本地文件夹加载该模型？' : 'Download complete! Would you like to load the model from the local folder now?')) {
        onClose();
        alert(lang === 'zh' ? '请点击主界面的"导入本地 URDF"并选择刚才下载的文件夹。' : 'Please click "Import Local URDF" on the main screen and select the folder you just downloaded.');
      }
      
    } catch (err: any) {
      setIsDownloading(false);
      console.error('Github download failed:', err);
      if (err.name !== 'AbortError') {
        alert(lang === 'zh' ? `下载失败: ${err.message}` : `Download failed: ${err.message}`);
      }
    }
  };

  const handleImportModel = async (model: RobotModel) => {
    if (!model.urdfPath) return;

    if (model.sourceType === 'url') {
      await downloadFromGithub(model);
      return;
    }
    
    setIsDownloading(true);
    try {
      const manifestUrl = `${model.urdfPath}/manifest.json`;
      const manifestRes = await fetch(manifestUrl);
      if (!manifestRes.ok) throw new Error('Manifest not found');
      const files: string[] = await manifestRes.json();
      
      const fileObjects = await Promise.all(files.map(async (filePath) => {
          const res = await fetch(`${model.urdfPath}/${filePath}`);
          const blob = await res.blob();
          const fileName = filePath.split('/').pop()!;
          const file = new File([blob], fileName, { type: blob.type });
          
          const rootFolder = model.urdfPath?.split('/').pop() || model.name.replace(/\s+/g, '_');
          Object.defineProperty(file, 'webkitRelativePath', {
              value: `${rootFolder}/${filePath}`
          });
          
          return file;
      }));
      
      const mockEvent = {
          target: {
              files: fileObjects
          }
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      
      onImport(mockEvent);
      setIsDownloading(false);
      onClose();
      
    } catch (err) {
      setIsDownloading(false);
      console.error('Failed to import model:', err);
      alert(lang === 'zh' ? '加载模型文件失败，请确保 manifest.json 存在。' : 'Failed to load model files. Please ensure manifest.json exists.');
    }
  };

  const filteredModels = useMemo(() => {
    return ROBOT_MODELS.filter(model => {
      const matchesSearch = model.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            model.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            model.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory = selectedCategory === 'all' || model.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  const toggleMaximize = () => {
    setIsMaximized(!isMaximized);
    setIsMinimized(false);
  };

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  // Get window style based on state
  const getWindowStyle = (): React.CSSProperties => {
    if (isMaximized) {
      return {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
      };
    }
    if (isMinimized) {
      return {
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: size.width,
        height: 48,
      };
    }
    return {
      position: 'fixed',
      left: position.x,
      top: position.y,
      width: size.width,
      height: size.height,
    };
  };

  return (
    <>
      {/* Backdrop - no blur */}
      <div 
        className="fixed inset-0 z-[90] bg-black/50"
        onClick={onClose}
      />
      
      {/* Floating Window */}
      <div
        ref={containerRef}
        style={getWindowStyle()}
        className={`z-[100] bg-white dark:bg-panel-bg flex flex-col text-slate-900 dark:text-slate-100 overflow-hidden rounded-xl shadow-2xl dark:shadow-black border border-slate-200 dark:border-border-black ${
          isDragging || isResizing ? 'select-none' : ''
        } ${isDragging ? 'cursor-grabbing' : ''}`}
      >
        {/* Resize handles - only show when not maximized or minimized */}
        {!isMaximized && !isMinimized && (
          <>
            {/* Right edge resize handle */}
            <div
              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-[#0060FA]/20 transition-colors z-20"
              onMouseDown={(e) => handleResizeStart(e, 'right')}
            />
            {/* Bottom edge resize handle */}
            <div
              className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-[#0060FA]/20 transition-colors z-20"
              onMouseDown={(e) => handleResizeStart(e, 'bottom')}
            />
            {/* Bottom-right corner resize handle */}
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize hover:bg-[#0060FA]/30 transition-colors z-30"
              onMouseDown={(e) => handleResizeStart(e, 'corner')}
            >
              <svg className="w-4 h-4 text-slate-400" viewBox="0 0 16 16" fill="currentColor">
                <path d="M14 14H10V12H12V10H14V14Z" />
                <path d="M14 8H12V6H14V8Z" />
                <path d="M8 14H6V12H8V14Z" />
              </svg>
            </div>
          </>
        )}
        {/* Window Header - Draggable */}
        <div 
          className={`h-12 border-b border-slate-200 dark:border-border-black flex items-center justify-between px-4 bg-slate-50 dark:bg-element-active shrink-0 ${
            !isMaximized ? 'cursor-grab' : ''
          } ${isDragging ? 'cursor-grabbing' : ''}`}
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-[#0060FA] rounded-lg text-white">
                <LayoutGrid className="w-4 h-4" />
              </div>
              <h1 className="text-sm font-bold tracking-tight">
                {t.urdfSquare}
              </h1>
            </div>
            
            {!isMinimized && (
              <div className="hidden md:flex ml-4 relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input 
                  type="text"
                  placeholder={t.searchModels}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white dark:bg-black border border-slate-200 dark:border-element-hover rounded-lg py-1.5 pl-9 pr-3 text-xs focus:ring-2 focus:ring-[#0060FA] transition-all"
                  onMouseDown={(e) => e.stopPropagation()}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button 
              onClick={toggleMinimize}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-element-hover rounded-md transition-colors"
              title={t.minimize}
            >
              <Minus className="w-4 h-4 text-slate-500" />
            </button>
            <button 
              onClick={toggleMaximize}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-element-hover rounded-md transition-colors"
              title={isMaximized ? t.restore : t.maximize}
            >
              {isMaximized ? <Minimize2 className="w-4 h-4 text-slate-500" /> : <Maximize2 className="w-4 h-4 text-slate-500" />}
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-md transition-colors"
              title={t.close}
            >
              <X className="w-4 h-4 text-slate-500 hover:text-red-500" />
            </button>
          </div>
        </div>

        {/* Content - Hidden when minimized */}
        {!isMinimized && (
          <div className="flex-1 flex overflow-hidden relative">
            {/* Sidebar */}
            <div className="w-48 border-r border-slate-200 dark:border-border-black bg-slate-50 dark:bg-panel-bg p-3 overflow-y-auto hidden lg:block">
              <div className="space-y-4">
                <div>
                  <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2">
                    {t.categories}
                  </h3>
                  <div className="space-y-0.5">
                    {CATEGORIES.map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-all ${
                          selectedCategory === cat.id 
                            ? 'bg-[#0060FA]/10 dark:bg-[#0060FA] text-[#0060FA] dark:text-white font-medium' 
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-hover'
                        }`}
                      >
                        <cat.icon className="w-3.5 h-3.5" />
                        {getCategoryName(cat.id, t)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto bg-white dark:bg-[#151515]">
              <div className="p-4">
                {/* Page Header */}
                <div className="mb-4">
                  <div className="flex items-center gap-2 text-[#0060FA] dark:text-[#0060FA] text-xs font-medium mb-1">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    <span>{t.featuredModels}</span>
                  </div>
                  <h2 className="text-xl font-bold text-slate-800 dark:text-white">
                    {t.findNextProject}
                  </h2>
                </div>

                {/* Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {filteredModels.map(model => (
                    <div key={model.id} className="group bg-white dark:bg-panel-bg rounded-lg border border-slate-200 dark:border-border-black hover:border-[#0060FA] dark:hover:border-[#0060FA] overflow-hidden transition-all shadow-md hover:shadow-2xl dark:shadow-black flex flex-col">
                      {/* Thumbnail Area */}
                      <div className="relative h-36 overflow-hidden bg-slate-100 dark:bg-black flex items-center justify-center">
                        <RobotThumbnail model={model} theme={theme} />
                        
                        <div className="absolute top-2 left-2 flex gap-1">
                          <span className="px-1.5 py-0.5 bg-white/90 dark:bg-black/80 text-slate-900 dark:text-white text-[9px] font-bold rounded uppercase shadow-sm backdrop-blur-[2px]">
                            {getCategoryName(model.category, t)}
                          </span>
                        </div>
                        
                        {/* Action Overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3 pointer-events-none">
                          <button 
                            onClick={() => handleImportModel(model)}
                            className="w-full py-1.5 bg-white dark:bg-[#0060FA] text-slate-900 dark:text-white rounded-md text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-[#0060FA] dark:hover:bg-blue-600 hover:text-white transition-colors pointer-events-auto">
                            <Download className="w-3.5 h-3.5" />
                            {t.importNow}
                          </button>
                        </div>
                      </div>

                      {/* Details */}
                      <div className="p-3 flex-1 flex flex-col">
                        <div className="flex justify-between items-start mb-1">
                          <h3 className="font-bold text-sm leading-tight group-hover:text-[#0060FA] transition-colors">
                            {lang === 'zh' && MODEL_TRANSLATIONS[model.id]?.name_zh ? MODEL_TRANSLATIONS[model.id].name_zh : model.name}
                          </h3>
                          <button className="text-slate-400 hover:text-red-500 transition-colors">
                            <Heart className="w-4 h-4" />
                          </button>
                        </div>
                        
                        <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 mb-2">
                          <User className="w-3 h-3" />
                          <span>{t.unitreeTech}</span>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mb-2 flex-1">
                          {lang === 'zh' && MODEL_TRANSLATIONS[model.id]?.description_zh ? MODEL_TRANSLATIONS[model.id].description_zh : model.description}
                        </p>

                        <div className="flex flex-wrap gap-1 mb-2">
                          {(lang === 'zh' && MODEL_TRANSLATIONS[model.id]?.tags_zh ? MODEL_TRANSLATIONS[model.id].tags_zh : model.tags).slice(0, 3).map((tag, idx) => (
                            <span key={idx} className="px-1.5 py-0.5 bg-slate-100 dark:bg-app-bg text-slate-600 dark:text-slate-300 text-[9px] rounded-full">
                              #{tag}
                            </span>
                          ))}
                        </div>

                        <div className="pt-2 border-t border-slate-100 dark:border-border-black flex items-center justify-between text-[10px] text-slate-400">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              <Star className="w-3 h-3" />
                              <span>{model.stars}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Download className="w-3 h-3" />
                              <span>{model.downloads}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{model.lastUpdated}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {filteredModels.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-12 h-12 bg-slate-100 dark:bg-app-bg rounded-full flex items-center justify-center mb-3">
                      <Search className="w-6 h-6 text-slate-300" />
                    </div>
                    <h3 className="text-lg font-bold mb-1">{t.noModelsFound}</h3>
                    <p className="text-sm text-slate-500">{t.changeSearchKeywords}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Loading Indicator */}
        {isDownloading && (
          <div className="absolute bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-2 bg-white dark:bg-panel-bg shadow-md dark:shadow-xl rounded-lg border border-slate-200 dark:border-border-black">
            <Loader2 className="w-4 h-4 text-[#0060FA] animate-spin" />
            <div className="flex flex-col">
              <span className="text-xs font-bold">{t.processing}</span>
              <span className="text-[9px] text-slate-500">{t.fetchingResources}</span>
            </div>
          </div>
        )}
        
        {/* Resize indicator when resizing */}
        {isResizing && (
          <div className="absolute bottom-2 right-2 z-50 px-2 py-1 bg-[#0060FA] text-white text-[10px] rounded font-mono">
            {size.width} × {size.height}
          </div>
        )}
      </div>
    </>
  );
};

export default URDFSquare;
