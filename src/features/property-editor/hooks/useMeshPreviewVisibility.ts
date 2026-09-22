import { useCallback, useEffect, useState } from 'react';

/** Tracks clipping and sidebar transforms without polling or unloading the mesh. */
export function useMeshPreviewVisibility() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const previewRef = useCallback((nextElement: HTMLDivElement | null) => {
    setElement(nextElement);
    setIsVisible(false);
  }, []);

  useEffect(() => {
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!active) return;
        for (const entry of entries) {
          if (entry.target === element) {
            setIsVisible(entry.isIntersecting && entry.intersectionRatio > 0);
          }
        }
      },
      // Edge-touching counts as intersecting with zero area. A positive
      // threshold also reports the next step from that edge into the viewport.
      { threshold: [0, Number.EPSILON] },
    );
    observer.observe(element);

    return () => {
      active = false;
      observer.disconnect();
    };
  }, [element]);

  return { previewRef, isVisible };
}
