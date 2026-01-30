# Changes Implemented

I have optimized the collision body update process to support partial reloading. Now, modifying collision parameters (origin, dimensions) will update the 3D scene directly without triggering a full robot model reload.

## Key Changes

1.  **`src/app/AppLayout.tsx`**:
    *   Introduced `robotVersion` state to control when a full reload is necessary.
    *   Updated `handleUpdate` to detect if an update is purely related to collision properties.
    *   If the update is collision-only, `robotVersion` is NOT incremented, preventing the full reload.

2.  **`src/features/urdf-viewer/components/URDFViewer.tsx`**:
    *   Passed the `robotVersion` prop down to `RobotModel`.

3.  **`src/features/urdf-viewer/components/RobotModel.tsx`**:
    *   Renamed internal `robotVersion` state to `localRobotVersion` to avoid naming conflicts.
    *   Updated the main robot loading `useEffect` to depend on `robotVersion` (prop) instead of `urdfContent`.
    *   Used a `useRef` to access the latest `urdfContent` without triggering effects.
    *   **New Feature**: Added a new `useEffect` that watches `robotLinks`. It compares the new collision data with the previous state. If differences are found (in origin or geometry), it directly updates the corresponding Three.js meshes (position, rotation, or geometry reconstruction) and requests a frame invalidation.

## Result
Modifying collision body parameters in the Property Editor will now be instant and smooth, as it bypasses the expensive URDF parsing and object reconstruction process. Structural changes (adding/removing links) or other property changes will still trigger a safe full reload.