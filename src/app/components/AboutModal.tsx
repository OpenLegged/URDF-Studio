/**
 * About Modal Component
 * Displays application information, version, and links
 */
import React from 'react';
import { X, ArrowRight, Github } from 'lucide-react';
import { useUIStore } from '@/store';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  const lang = useUIStore((state) => state.lang);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-[400px] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 px-6 py-5 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logos/logo.png" alt="URDF Studio" className="w-10 h-10 object-contain" />
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">URDF Studio</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">v1.0.0</p>
              </div>
            </div>
            <button
              onClick={onClose}
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
              href="https://www.motphys.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
            >
              <div className="w-9 h-9 bg-white dark:bg-slate-700 rounded-lg flex items-center justify-center overflow-hidden border border-slate-100 dark:border-slate-600">
                <img
                  src="/logos/Motphys_Logo_only_Black_100x100px.svg"
                  alt="Motphys"
                  className="w-full h-full object-contain p-1 dark:hidden"
                />
                <img
                  src="/logos/Motphys_Logo_only_White_100x100px.svg"
                  alt="Motphys"
                  className="w-full h-full object-contain p-1 hidden dark:block"
                />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-800 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  Motphys
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {lang === 'zh' ? '超越物理，进化不止' : 'Evolution Beyond Physics'}
                </div>
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
                <img src="/logos/d-robotics-logo.jpg" alt="D-Robotics" className="w-full h-full object-cover" />
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
  );
}

export default AboutModal;
