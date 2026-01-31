/**
 * RobotPreview - Smart preview component
 * Uses pre-recorded animated WebP if available, falls back to 3D rendering
 * This significantly reduces CPU/GPU usage for the URDF Square
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Loader2 } from 'lucide-react';
import { RobotThumbnail3D } from './RobotThumbnail3D';

interface RobotPreviewProps {
  urdfPath: string;
  modelId: string;
  theme?: 'light' | 'dark';
}

/**
 * RobotPreview - Tries to load animated preview first, falls back to 3D
 */
export const RobotPreview: React.FC<RobotPreviewProps> = ({ 
  urdfPath, 
  modelId,
  theme = 'dark' 
}) => {
  const [previewType, setPreviewType] = useState<'loading' | 'animated' | '3d'>('loading');
  const [animationUrl, setAnimationUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Lazy loading with IntersectionObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Check for pre-recorded animation when visible
  useEffect(() => {
    if (!isVisible) return;

    const checkForAnimation = async () => {
      // Try to load pre-recorded WebP animation
      const animPath = `${urdfPath}/preview.webp`;
      
      try {
        const response = await fetch(animPath, { method: 'HEAD' });
        if (response.ok) {
          setAnimationUrl(animPath);
          setPreviewType('animated');
          return;
        }
      } catch (e) {
        // Animation not found, use 3D
      }
      
      // Fallback to 3D rendering
      setPreviewType('3d');
    };

    checkForAnimation();
  }, [urdfPath, isVisible]);

  // Loading state
  if (!isVisible || previewType === 'loading') {
    return (
      <div 
        ref={containerRef} 
        className="flex items-center justify-center w-full h-full bg-slate-100 dark:bg-[#000000]"
      >
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  // Animated preview (WebP)
  if (previewType === 'animated' && animationUrl) {
    return (
      <div 
        ref={containerRef}
        className="w-full h-full flex items-center justify-center overflow-hidden"
        style={{ backgroundColor: theme === 'light' ? '#f8f9fa' : '#000000' }}
      >
        <img 
          src={animationUrl}
          alt={`${modelId} preview`}
          className="w-full h-full object-contain"
          loading="lazy"
        />
      </div>
    );
  }

  // 3D fallback
  return (
    <div ref={containerRef} className="w-full h-full">
      <RobotThumbnail3D urdfPath={urdfPath} theme={theme} />
    </div>
  );
};

export default RobotPreview;
