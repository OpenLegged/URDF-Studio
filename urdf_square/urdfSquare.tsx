import React, { useState, useMemo } from 'react';
import { X, LayoutGrid, Search, Filter, Box, User, Heart, Download, ExternalLink, ChevronRight, Star, Clock, Globe, ArrowUpRight, RotateCcw, Loader2 } from 'lucide-react';

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
  sourceType: 'server' | 'git'; // 新增：server 表示服务器存储，git 表示外部链接
}

const MOCK_MODELS: RobotModel[] = [
  {
    id: '1',
    name: 'Unitree Go2',
    author: 'Unitree Robotics',
    description: 'High-performance quadruped robot for research and entertainment.',
    thumbnail: '/library/urdf/unitree/go2_description/thumbnail.png',
    category: 'Quadruped',
    stars: 0,
    downloads: 0,
    tags: ['Research', 'Quadruped', 'Mobile'],
    lastUpdated: '2026-01-17',
    urdfPath: '/library/urdf/unitree/go2_description',
    sourceType: 'server'
  },
  {
    id: '2',
    name: 'Unitree G1',
    author: 'Unitree Robotics',
    description: 'Humanoid robot for education and research.',
    thumbnail: '/library/urdf/unitree/g1_thumbnail.jpg',
    category: 'Humanoid',
    stars: 0,
    downloads: 0,
    tags: ['Humanoid', 'Bipedal', 'Mobile'],
    lastUpdated: '2026-01-17',
    urdfPath: 'https://github.com/unitreerobotics/unitree_ros/blob/master/robots/g1_description',
    sourceType: 'git'
  }
];

const CATEGORIES = [
  { id: 'all', name_en: 'All Models', name_zh: '全部模型', icon: Box },
  { id: 'Quadruped', name_en: 'Quadruped', name_zh: '四足机器人', icon: Box },
  { id: 'Manipulator', name_en: 'Manipulators', name_zh: '机械臂', icon: Box },
  { id: 'Humanoid', name_en: 'Humanoids', name_zh: '人形机器人', icon: User },
  { id: 'Mobile', name_en: 'Mobile Bases', name_zh: '移动底盘', icon: Globe },
];

const RobotThumbnail = ({ model }: { model: RobotModel }) => {
  const [imageError, setImageError] = useState(false);

  // Try to load the static thumbnail first
  // 优先使用明确指定的 thumbnail。如果是 server 类型且未指定 thumbnail，则尝试从 urdfPath 推断
  const staticThumbnailPath = model.thumbnail || (model.sourceType === 'server' && model.urdfPath ? `${model.urdfPath}/thumbnail.png` : '');

  if (imageError || !staticThumbnailPath) {
    return (
      <div className="flex flex-col items-center gap-2 text-slate-300 dark:text-slate-600">
        <Box className="w-12 h-12 opacity-20" />
        <span className="text-[10px] uppercase tracking-widest font-bold opacity-30">No Preview</span>
      </div>
    );
  }

  return (
    <img 
      src={staticThumbnailPath} 
      alt={model.name}
      className="w-full h-full object-cover"
      onError={() => setImageError(true)}
    />
  );
};

export const URDFSquare: React.FC<URDFSquareProps> = ({ onClose, lang, onImport }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isDownloading, setIsDownloading] = useState(false);

  const loadFromGithub = async (model: RobotModel) => {
    if (!model.urdfPath) return;
    setIsDownloading(true);

    try {
      // 1. 解析 GitHub URL 以便使用 API
      // 格式: https://github.com/owner/repo/blob/branch/path
      const url = new URL(model.urdfPath);
      const parts = url.pathname.split('/').filter(Boolean);
      const owner = parts[0];
      const repo = parts[1];
      const branch = parts[3];
      const path = parts.slice(4).join('/');

      // 2. 构建 GitHub API 递归请求
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
      
      const fileObjects: File[] = [];
      const rootFolder = model.name.replace(/\s+/g, '_');

      // 3. 定义递归下载函数
      const fetchRecursive = async (requestUrl: string, currentPath: string) => {
        const response = await fetch(requestUrl);
        if (!response.ok) throw new Error('GitHub API request failed');
        const contents = await response.json();
        
        const items = Array.isArray(contents) ? contents : [contents];

        for (const item of items) {
          if (item.type === 'file') {
            const fileRes = await fetch(item.download_url);
            const blob = await fileRes.blob();
            const file = new File([blob], item.name, { type: blob.type });
            
            // Patch webkitRelativePath
            const relativePath = currentPath ? `${currentPath}/${item.name}` : item.name;
            Object.defineProperty(file, 'webkitRelativePath', {
                value: `${rootFolder}/${relativePath}`
            });
            fileObjects.push(file);
            
          } else if (item.type === 'dir') {
            await fetchRecursive(item.url, currentPath ? `${currentPath}/${item.name}` : item.name);
          }
        }
      };

      await fetchRecursive(apiUrl, '');
      
      // 4. Create mock event and call onImport
      const mockEvent = {
          target: {
              files: fileObjects
          }
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      
      onImport(mockEvent);
      setIsDownloading(false);
      onClose();
      
    } catch (err: any) {
      setIsDownloading(false);
      console.error('Github load failed:', err);
      alert(lang === 'zh' ? `加载失败: ${err.message}` : `Load failed: ${err.message}`);
    }
  };

  const handleImportModel = async (model: RobotModel) => {
    if (!model.urdfPath) return;

    if (model.sourceType === 'git') {
      await loadFromGithub(model);
      return;
    }
    
    setIsDownloading(true);
    try {
      // 1. Fetch manifest
      const manifestUrl = `${model.urdfPath}/manifest.json`;
      const manifestRes = await fetch(manifestUrl);
      if (!manifestRes.ok) throw new Error('Manifest not found');
      const files: string[] = await manifestRes.json();
      
      // 2. Fetch all files
      const fileObjects = await Promise.all(files.map(async (filePath) => {
          const res = await fetch(`${model.urdfPath}/${filePath}`);
          const blob = await res.blob();
          // Create File object with webkitRelativePath patch
          const fileName = filePath.split('/').pop()!;
          const file = new File([blob], fileName, { type: blob.type });
          
          // Patch webkitRelativePath for folder structure preservation
          // Use the folder name from urdfPath as the root directory
          const rootFolder = model.urdfPath?.split('/').pop() || model.name.replace(/\s+/g, '_');
          Object.defineProperty(file, 'webkitRelativePath', {
              value: `${rootFolder}/${filePath}`
          });
          
          return file;
      }));
      
      // 3. Create mock event
      const mockEvent = {
          target: {
              files: fileObjects
          }
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      
      // 4. Call handler
      onImport(mockEvent);
      setIsDownloading(false);
      onClose(); // Close the square
      
    } catch (err) {
      setIsDownloading(false);
      console.error('Failed to import model:', err);
      alert(lang === 'zh' ? '加载模型文件失败，请确保 manifest.json 存在。' : 'Failed to load model files. Please ensure manifest.json exists.');
    }
  };

  const filteredModels = useMemo(() => {
    return MOCK_MODELS.filter(model => {
      const matchesSearch = model.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            model.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            model.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory = selectedCategory === 'all' || model.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  return (
    <div className="fixed inset-0 z-[100] bg-white dark:bg-slate-900 flex flex-col text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Navbar */}
      <div className="h-16 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 bg-white dark:bg-slate-800 z-10 shadow-sm shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-600 rounded-lg text-white">
              <LayoutGrid className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              {lang === 'zh' ? 'URDF 广场' : 'URDF Square'}
            </h1>
          </div>
          
          <div className="hidden md:flex ml-8 relative w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text"
              placeholder={lang === 'zh' ? '搜索模型、作者、标签...' : 'Search models, authors, tags...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-100 dark:bg-slate-700/50 border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-indigo-500 transition-all focus:bg-white dark:focus:bg-slate-700"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm">
            <ArrowUpRight className="w-4 h-4" />
            {lang === 'zh' ? '分享我的模型' : 'Share Model'}
          </button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-2" />
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
          >
            <X className="w-6 h-6 text-slate-500" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar */}
        <div className="w-64 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 p-4 overflow-y-auto hidden lg:block">
          <div className="space-y-6">
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">
                {lang === 'zh' ? '分类探索' : 'Explore Categories'}
              </h3>
              <div className="space-y-1">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                      selectedCategory === cat.id 
                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium' 
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <cat.icon className="w-4 h-4" />
                    {lang === 'zh' ? cat.name_zh : cat.name_en}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-900/50">
          <div className="p-6 md:p-8 max-w-7xl mx-auto">
            {/* Page Header */}
            <div className="mb-8">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-sm font-medium mb-2">
                <Star className="w-4 h-4 fill-current" />
                <span>{lang === 'zh' ? '精选推荐' : 'Featured Models'}</span>
              </div>
              <h2 className="text-3xl font-bold text-slate-800 dark:text-white mb-4">
                {lang === 'zh' ? '发现您的下一个机器人项目' : 'Find Your Next Robot Project'}
              </h2>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredModels.map(model => (
                <div key={model.id} className="group bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 overflow-hidden transition-all hover:shadow-xl flex flex-col">
                  {/* Thumbnail Area - Now rendering 3D Model */}
                  <div className="relative h-48 sm:h-56 overflow-hidden bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
                    <RobotThumbnail model={model} />
                    
                    <div className="absolute top-3 left-3 flex gap-2">
                      <span className="px-2 py-1 bg-slate-900/60 backdrop-blur-md text-white text-[10px] font-bold rounded uppercase">
                        {model.category}
                      </span>
                    </div>
                    
                    {/* Action Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4 pointer-events-none">
                      <button 
                        onClick={() => handleImportModel(model)}
                        className="w-full py-2 bg-white text-slate-900 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-indigo-50 transition-colors pointer-events-auto">
                        <Download className="w-4 h-4" />
                        {lang === 'zh' ? '立即导入' : 'Import Now'}
                      </button>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="p-5 flex-1 flex flex-col">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold text-lg leading-tight group-hover:text-indigo-600 transition-colors">{model.name}</h3>
                      <button className="text-slate-400 hover:text-red-500 transition-colors">
                        <Heart className="w-5 h-5" />
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-3">
                      <User className="w-3.5 h-3.5" />
                      <span>{model.author}</span>
                    </div>

                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mb-4 flex-1">
                      {model.description}
                    </p>

                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {model.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] rounded-full">
                          #{tag}
                        </span>
                      ))}
                    </div>

                    <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-[11px] text-slate-400">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1">
                          <Star className="w-3.5 h-3.5" />
                          <span>{model.stars > 1000 ? (model.stars/1000).toFixed(1)+'k' : model.stars}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Download className="w-3.5 h-3.5" />
                          <span>{model.downloads > 1000 ? (model.downloads/1000).toFixed(1)+'k' : model.downloads}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{model.lastUpdated}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {filteredModels.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                  <Search className="w-8 h-8 text-slate-300" />
                </div>
                <h3 className="text-xl font-bold mb-2">{lang === 'zh' ? '未找到相关模型' : 'No models found'}</h3>
                <p className="text-slate-500">{lang === 'zh' ? '尝试更换搜索关键词或分类' : 'Try changing your search keywords or category'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Loading Indicator */}
      {isDownloading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-6 px-12 py-10 bg-white dark:bg-slate-800 shadow-2xl rounded-2xl border border-slate-200 dark:border-slate-700">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
            <div className="flex flex-col items-center text-center gap-2">
              <span className="text-xl font-bold text-slate-900 dark:text-white">{lang === 'zh' ? '正在处理中...' : 'Processing...'}</span>
              <span className="text-base text-slate-500">{lang === 'zh' ? '正在从云端获取模型资源，请稍候' : 'Fetching model resources, please wait'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
