import React, { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import { X, LayoutGrid, Search, Filter, Box, User, Heart, Download, ExternalLink, ChevronRight, Star, Clock, Globe, ArrowUpRight, RotateCcw } from 'lucide-react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Stage, Environment } from '@react-three/drei';
// @ts-ignore
import URDFLoader from 'urdf-loader';
import * as THREE from 'three';

interface URDFSquareProps {
  onClose: () => void;
  lang: 'en' | 'zh';
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
    urdfPath: '/library/urdf/unitree/go2_description' 
  }
//   {
//     id: '2',
//     name: 'Universal Robots UR5',
//     author: 'UR Open Source',
//     description: 'Collaborative industrial robotic arm with 6 degrees of freedom.',
//     thumbnail: 'https://images.unsplash.com/photo-1563206767-5b18f218e7de?w=400&h=300&fit=crop',
//     category: 'Manipulator',
//     stars: 890,
//     downloads: 3200,
//     tags: ['Industrial', 'Arm', 'ROS'],
//     lastUpdated: '2026-01-05'
//   },
//   {
//     id: '3',
//     name: 'Boston Dynamics Spot',
//     author: 'Community Contributor',
//     description: 'Community-made URDF for the famous yellow quadruped robot.',
//     thumbnail: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=400&h=300&fit=crop',
//     category: 'Quadruped',
//     stars: 2100,
//     downloads: 9500,
//     tags: ['Boston Dynamics', 'Mobile', 'Advanced'],
//     lastUpdated: '2025-11-15'
//   },
//   {
//     id: '4',
//     name: 'Frankas Emika Panda',
//     author: 'Franka Research',
//     description: 'Sensitive robotic arm with torque sensors in all joints.',
//     thumbnail: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=400&h=300&fit=crop',
//     category: 'Manipulator',
//     stars: 650,
//     downloads: 1800,
//     tags: ['Research', 'High-Precision', 'Arm'],
//     lastUpdated: '2026-01-10'
//   },
//   {
//     id: '5',
//     name: 'Bipedal Humanoid X',
//     author: 'AILab',
//     description: 'Open source humanoid robot skeleton for deep reinforcement learning.',
//     thumbnail: 'https://images.unsplash.com/photo-1531746790731-6c087fecd05a?w=400&h=300&fit=crop',
//     category: 'Humanoid',
//     stars: 420,
//     downloads: 1100,
//     tags: ['Humanoid', 'Bipedal', 'Learning'],
//     lastUpdated: '2026-01-12'
//   },
//   {
//     id: '6',
//     name: 'Generic Delivery Bot',
//     author: 'LastMile Tech',
//     description: 'Small 4-wheeled mobile robot for indoor delivery testing.',
//     thumbnail: 'https://images.unsplash.com/photo-1558137623-af93c27e30e9?w=400&h=300&fit=crop',
//     category: 'Mobile',
//     stars: 150,
//     downloads: 450,
//     tags: ['Wheeled', 'Indoor', 'Small'],
//     lastUpdated: '2025-10-24'
//   }
];

const CATEGORIES = [
  { id: 'all', name_en: 'All Models', name_zh: '全部模型', icon: Box },
  { id: 'Quadruped', name_en: 'Quadruped', name_zh: '四足机器人', icon: Box },
  { id: 'Manipulator', name_en: 'Manipulators', name_zh: '机械臂', icon: Box },
  { id: 'Humanoid', name_en: 'Humanoids', name_zh: '人形机器人', icon: User },
  { id: 'Mobile', name_en: 'Mobile Bases', name_zh: '移动底盘', icon: Globe },
];

const RobotThumbnail = ({ model }: { model: RobotModel }) => {
  const [robot, setRobot] = useState<THREE.Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [use3D, setUse3D] = useState(false);

  // Try to load the static thumbnail first
  const staticThumbnailPath = model.urdfPath ? `${model.urdfPath}/thumbnail.png` : model.thumbnail;

  useEffect(() => {
    // Only load 3D if we've decided to use it (or if there's no static thumbnail)
    if (!use3D || !model.urdfPath) return;

    const loader = new URDFLoader();
    const pkgName = model.urdfPath.split('/').filter(Boolean).pop() || '';
    if (pkgName) {
      loader.packages = { [pkgName]: model.urdfPath };
    }
    
    const urdfFile = `${model.urdfPath}/urdf/go2_description.urdf`.replace(/\\/g, '/');
    
    loader.load(
      urdfFile,
      (result: any) => {
        result.rotation.x = -Math.PI / 2;
        result.updateMatrixWorld();
        setRobot(result);
        setLoading(false);
      },
      undefined,
      (err: any) => {
        console.error('Error loading URDF for thumbnail:', err);
        setError(true);
        setLoading(false);
      }
    );
  }, [use3D, model.urdfPath]);

  // If we are not using 3D yet, try to show the image
  if (!use3D) {
    return (
      <img 
        src={staticThumbnailPath} 
        alt={model.name}
        className="w-full h-full object-cover"
        onError={() => setUse3D(true)} // If image fails, switch to 3D
      />
    );
  }

  if (error || !model.urdfPath) {
    return (
      <div className="flex flex-col items-center gap-2 text-slate-300 dark:text-slate-600">
        <Box className="w-12 h-12 opacity-20" />
        <span className="text-[10px] uppercase tracking-widest font-bold opacity-30">No Preview</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <Canvas 
        shadows 
        camera={{ position: [2, 2, 2], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={['#f8fafc']} />
        <Suspense fallback={null}>
          <Stage 
            intensity={1} 
            environment="city" 
            adjustCamera={true} 
            shadows="contact"
            center={{ top: true }}
          >
            {robot && <primitive object={robot} />}
          </Stage>
          <gridHelper args={[10, 10, 0xcccccc, 0xeeeeee]} position={[0, -0.01, 0]} />
        </Suspense>
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} castShadow />
      </Canvas>
      {robot && robot.children.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[10px] text-slate-400">Empty Model</span>
        </div>
      )}
    </div>
  );
};

export const URDFSquare: React.FC<URDFSquareProps> = ({ onClose, lang }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

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

      <div className="flex-1 flex overflow-hidden">
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
                      <button className="w-full py-2 bg-white text-slate-900 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-indigo-50 transition-colors pointer-events-auto">
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
    </div>
  );
};
