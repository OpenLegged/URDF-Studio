import { useState, useEffect } from 'react';

export interface ViewerSettings {
    showCollision: boolean;
    setShowCollision: React.Dispatch<React.SetStateAction<boolean>>;
    localShowVisual: boolean;
    setLocalShowVisual: React.Dispatch<React.SetStateAction<boolean>>;
    showJointControls: boolean;
    setShowJointControls: React.Dispatch<React.SetStateAction<boolean>>;
    showCenterOfMass: boolean;
    setShowCenterOfMass: React.Dispatch<React.SetStateAction<boolean>>;
    showCoMOverlay: boolean;
    setShowCoMOverlay: React.Dispatch<React.SetStateAction<boolean>>;
    centerOfMassSize: number;
    setCenterOfMassSize: React.Dispatch<React.SetStateAction<number>>;
    showInertia: boolean;
    setShowInertia: React.Dispatch<React.SetStateAction<boolean>>;
    showInertiaOverlay: boolean;
    setShowInertiaOverlay: React.Dispatch<React.SetStateAction<boolean>>;
    showOrigins: boolean;
    setShowOrigins: React.Dispatch<React.SetStateAction<boolean>>;
    showOriginsOverlay: boolean;
    setShowOriginsOverlay: React.Dispatch<React.SetStateAction<boolean>>;
    originSize: number;
    setOriginSize: React.Dispatch<React.SetStateAction<number>>;
    showJointAxes: boolean;
    setShowJointAxes: React.Dispatch<React.SetStateAction<boolean>>;
    showJointAxesOverlay: boolean;
    setShowJointAxesOverlay: React.Dispatch<React.SetStateAction<boolean>>;
    jointAxisSize: number;
    setJointAxisSize: React.Dispatch<React.SetStateAction<number>>;
    modelOpacity: number;
    setModelOpacity: React.Dispatch<React.SetStateAction<number>>;
    highlightMode: 'link' | 'collision';
    setHighlightMode: React.Dispatch<React.SetStateAction<'link' | 'collision'>>;
    isOptionsCollapsed: boolean;
    toggleOptionsCollapsed: () => void;
    isJointsCollapsed: boolean;
    toggleJointsCollapsed: () => void;
}

export function useViewerSettings(): ViewerSettings {
    const [showCollision, setShowCollision] = useState(false);
    const [localShowVisual, setLocalShowVisual] = useState(true);
    const [showJointControls, setShowJointControls] = useState(true);
    const [showCenterOfMass, setShowCenterOfMass] = useState(false);
    const [showCoMOverlay, setShowCoMOverlay] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_com_overlay');
            return saved !== 'false'; // Default true
        }
        return true;
    });
    const [centerOfMassSize, setCenterOfMassSize] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_com_size');
            return saved ? Math.min(parseFloat(saved), 0.5) : 0.01;
        }
        return 0.01;
    });
    const [showInertia, setShowInertia] = useState(false);
    const [showInertiaOverlay, setShowInertiaOverlay] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_inertia_overlay');
            return saved !== 'false';
        }
        return true;
    });
    const [showOrigins, setShowOrigins] = useState(false);
    const [showOriginsOverlay, setShowOriginsOverlay] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_origin_overlay');
            return saved !== 'false';
        }
        return true;
    });
    const [originSize, setOriginSize] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_origin_size');
            return saved ? Math.min(parseFloat(saved), 0.5) : 0.1;
        }
        return 0.1;
    });
    const [showJointAxes, setShowJointAxes] = useState(false);
    const [showJointAxesOverlay, setShowJointAxesOverlay] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_joint_axis_overlay');
            return saved !== 'false';
        }
        return true;
    });
    const [jointAxisSize, setJointAxisSize] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_joint_axis_size');
            return saved ? Math.min(parseFloat(saved), 2.0) : 0.1;
        }
        return 0.1;
    });
    const [modelOpacity, setModelOpacity] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_model_opacity');
            return saved ? parseFloat(saved) : 1.0;
        }
        return 1.0;
    });

    const [highlightMode, setHighlightMode] = useState<'link' | 'collision'>('link');

    const [isOptionsCollapsed, setIsOptionsCollapsed] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_options_collapsed');
            return saved === 'true';
        }
        return false;
    });
    const [isJointsCollapsed, setIsJointsCollapsed] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_joints_collapsed');
            return saved === 'true';
        }
        return false;
    });

    useEffect(() => {
        localStorage.setItem('urdf_viewer_origin_size', originSize.toString());
    }, [originSize]);

    useEffect(() => {
        localStorage.setItem('urdf_viewer_com_size', centerOfMassSize.toString());
    }, [centerOfMassSize]);

    useEffect(() => {
        localStorage.setItem('urdf_viewer_com_overlay', showCoMOverlay.toString());
    }, [showCoMOverlay]);

    useEffect(() => {
        localStorage.setItem('urdf_viewer_inertia_overlay', showInertiaOverlay.toString());
    }, [showInertiaOverlay]);

    useEffect(() => {
        localStorage.setItem('urdf_viewer_joint_axis_size', jointAxisSize.toString());
    }, [jointAxisSize]);

    useEffect(() => {
        localStorage.setItem('urdf_viewer_origin_overlay', showOriginsOverlay.toString());
    }, [showOriginsOverlay]);

    useEffect(() => {
        localStorage.setItem('urdf_viewer_joint_axis_overlay', showJointAxesOverlay.toString());
    }, [showJointAxesOverlay]);

    useEffect(() => {
        localStorage.setItem('urdf_viewer_model_opacity', modelOpacity.toString());
    }, [modelOpacity]);

    const toggleOptionsCollapsed = () => {
        setIsOptionsCollapsed(prev => {
            const newState = !prev;
            localStorage.setItem('urdf_viewer_options_collapsed', String(newState));
            return newState;
        });
    };

    const toggleJointsCollapsed = () => {
        setIsJointsCollapsed(prev => {
            const newState = !prev;
            localStorage.setItem('urdf_viewer_joints_collapsed', String(newState));
            return newState;
        });
    };

    return {
        showCollision, setShowCollision,
        localShowVisual, setLocalShowVisual,
        showJointControls, setShowJointControls,
        showCenterOfMass, setShowCenterOfMass,
        showCoMOverlay, setShowCoMOverlay,
        centerOfMassSize, setCenterOfMassSize,
        showInertia, setShowInertia,
        showInertiaOverlay, setShowInertiaOverlay,
        showOrigins, setShowOrigins,
        showOriginsOverlay, setShowOriginsOverlay,
        originSize, setOriginSize,
        showJointAxes, setShowJointAxes,
        showJointAxesOverlay, setShowJointAxesOverlay,
        jointAxisSize, setJointAxisSize,
        modelOpacity, setModelOpacity,
        highlightMode, setHighlightMode,
        isOptionsCollapsed, toggleOptionsCollapsed,
        isJointsCollapsed, toggleJointsCollapsed
    };
}
