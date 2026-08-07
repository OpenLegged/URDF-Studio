import React from 'react';

interface ResizeCornerIndicatorProps {
  className?: string;
}

export function ResizeCornerIndicator({ className = '' }: ResizeCornerIndicatorProps) {
  return (
    <span
      data-testid="resize-corner-indicator"
      className={`pointer-events-none absolute bottom-1 right-1 h-2 w-2 border-b border-r border-border-strong/80 opacity-70 transition-colors group-hover:border-system-blue/60 group-active:border-system-blue/80 ${className}`}
    />
  );
}
