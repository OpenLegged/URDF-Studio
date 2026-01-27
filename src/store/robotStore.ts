/**
 * Robot Store - Manages robot data and operations
 * Uses immer for immutable updates and includes history middleware for undo/redo
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { UrdfLink, UrdfJoint } from '@/types';
import { DEFAULT_LINK, DEFAULT_JOINT } from '@/types';

const INITIAL_LINK_ID = 'base_link';

// Robot data without selection (selection is in selectionStore)
export interface RobotData {
  name: string;
  links: Record<string, UrdfLink>;
  joints: Record<string, UrdfJoint>;
  rootLinkId: string;
  materials?: Record<string, { color?: string; texture?: string }>;
}

// History state for undo/redo
interface HistoryState {
  past: RobotData[];
  future: RobotData[];
}

interface RobotActions {
  // Robot name
  setName: (name: string) => void;

  // Full robot data operations
  setRobot: (data: RobotData) => void;
  resetRobot: (data?: RobotData) => void;

  // Link operations
  addLink: (link: UrdfLink) => void;
  updateLink: (id: string, updates: Partial<UrdfLink>) => void;
  deleteLink: (linkId: string) => void;
  setLinkVisibility: (id: string, visible: boolean) => void;
  setAllLinksVisibility: (visible: boolean) => void;

  // Joint operations
  addJoint: (joint: UrdfJoint) => void;
  updateJoint: (id: string, updates: Partial<UrdfJoint>) => void;
  deleteJoint: (jointId: string) => void;
  setJointAngle: (jointName: string, angle: number) => void;

  // Tree operations
  addChild: (parentLinkId: string) => { linkId: string; jointId: string };
  deleteSubtree: (linkId: string) => void;

  // History operations
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;

  // Computed values
  getJointAngles: () => Record<string, number>;
  getRootLink: () => UrdfLink | undefined;
  getLinkByName: (name: string) => UrdfLink | undefined;
  getJointByName: (name: string) => UrdfJoint | undefined;
  getChildJoints: (linkId: string) => UrdfJoint[];
  getParentJoint: (linkId: string) => UrdfJoint | undefined;
}

// Initial robot data
const INITIAL_ROBOT_DATA: RobotData = {
  name: 'my_robot',
  links: {
    [INITIAL_LINK_ID]: {
      ...DEFAULT_LINK,
      id: INITIAL_LINK_ID,
      name: 'base_link',
      visual: { ...DEFAULT_LINK.visual, color: '#64748b' }
    }
  },
  joints: {},
  rootLinkId: INITIAL_LINK_ID,
};

// Maximum history entries
const MAX_HISTORY = 50;

export const useRobotStore = create<RobotData & RobotActions & { _history: HistoryState }>()(
  immer((set, get) => {
    // Helper to save current state to history
    const saveToHistory = () => {
      const { name, links, joints, rootLinkId, materials, _history } = get();
      const currentData: RobotData = { name, links, joints, rootLinkId, materials };

      set((state) => {
        state._history.past = [...state._history.past, currentData].slice(-MAX_HISTORY);
        state._history.future = [];
      });
    };

    return {
      // Initial state
      ...INITIAL_ROBOT_DATA,
      _history: { past: [], future: [] },

      // Robot name
      setName: (name) => {
        saveToHistory();
        set((state) => {
          state.name = name;
        });
      },

      // Full robot data
      setRobot: (data) => {
        saveToHistory();
        set((state) => {
          state.name = data.name;
          state.links = data.links;
          state.joints = data.joints;
          state.rootLinkId = data.rootLinkId;
          state.materials = data.materials;
        });
      },

      resetRobot: (data) => {
        const newData = data || INITIAL_ROBOT_DATA;
        set((state) => {
          state.name = newData.name;
          state.links = newData.links;
          state.joints = newData.joints;
          state.rootLinkId = newData.rootLinkId;
          state.materials = newData.materials;
          state._history = { past: [], future: [] };
        });
      },

      // Link operations
      addLink: (link) => {
        saveToHistory();
        set((state) => {
          state.links[link.id] = link;
        });
      },

      updateLink: (id, updates) => {
        saveToHistory();
        set((state) => {
          if (state.links[id]) {
            Object.assign(state.links[id], updates);
          }
        });
      },

      deleteLink: (linkId) => {
        if (linkId === get().rootLinkId) return; // Cannot delete root
        saveToHistory();
        set((state) => {
          delete state.links[linkId];
          // Also delete joints connected to this link
          Object.keys(state.joints).forEach((jId) => {
            const joint = state.joints[jId];
            if (joint.parentLinkId === linkId || joint.childLinkId === linkId) {
              delete state.joints[jId];
            }
          });
        });
      },

      setLinkVisibility: (id, visible) => {
        saveToHistory();
        set((state) => {
          if (state.links[id]) {
            state.links[id].visible = visible;
          }
        });
      },

      setAllLinksVisibility: (visible) => {
        saveToHistory();
        set((state) => {
          Object.keys(state.links).forEach((id) => {
            state.links[id].visible = visible;
          });
        });
      },

      // Joint operations
      addJoint: (joint) => {
        saveToHistory();
        set((state) => {
          state.joints[joint.id] = joint;
        });
      },

      updateJoint: (id, updates) => {
        saveToHistory();
        set((state) => {
          if (state.joints[id]) {
            Object.assign(state.joints[id], updates);
          }
        });
      },

      deleteJoint: (jointId) => {
        saveToHistory();
        set((state) => {
          delete state.joints[jointId];
        });
      },

      setJointAngle: (jointName, angle) => {
        // Find joint by name
        const state = get();
        const jointEntry = Object.entries(state.joints).find(
          ([, j]) => j.name === jointName
        );
        if (!jointEntry) return;

        const [jointId] = jointEntry;
        // Don't save to history for joint angle changes (too frequent)
        set((state) => {
          if (state.joints[jointId]) {
            state.joints[jointId].angle = angle;
          }
        });
      },

      // Tree operations
      addChild: (parentLinkId) => {
        const state = get();
        const newLinkId = `link_${Date.now()}`;
        const newJointId = `joint_${Date.now()}`;

        // Calculate offset for new child
        const siblings = Object.values(state.joints).filter(
          (j) => j.parentLinkId === parentLinkId
        );
        const yOffset = siblings.length * 0.5;

        const newLink: UrdfLink = {
          ...DEFAULT_LINK,
          id: newLinkId,
          name: `link_${Object.keys(state.links).length + 1}`,
          visual: { ...DEFAULT_LINK.visual, color: '#3b82f6' }
        };

        const newJoint: UrdfJoint = {
          ...DEFAULT_JOINT,
          id: newJointId,
          name: `joint_${Object.keys(state.joints).length + 1}`,
          parentLinkId,
          childLinkId: newLinkId,
          origin: {
            xyz: { x: 0, y: yOffset, z: 0.5 },
            rpy: { r: 0, p: 0, y: 0 }
          },
        };

        saveToHistory();
        set((state) => {
          state.links[newLinkId] = newLink;
          state.joints[newJointId] = newJoint;
        });

        return { linkId: newLinkId, jointId: newJointId };
      },

      deleteSubtree: (linkId) => {
        const state = get();
        if (linkId === state.rootLinkId) return;

        const toDeleteLinks = new Set<string>();
        const toDeleteJoints = new Set<string>();

        // Recursively collect links and joints to delete
        const collect = (lId: string, visited: Set<string>) => {
          if (visited.has(lId)) return;
          visited.add(lId);

          toDeleteLinks.add(lId);
          Object.values(state.joints).forEach((j) => {
            if (j.parentLinkId === lId) {
              toDeleteJoints.add(j.id);
              collect(j.childLinkId, visited);
            }
            if (j.childLinkId === lId) {
              toDeleteJoints.add(j.id);
            }
          });
        };

        collect(linkId, new Set<string>());

        saveToHistory();
        set((state) => {
          toDeleteLinks.forEach((id) => delete state.links[id]);
          toDeleteJoints.forEach((id) => delete state.joints[id]);
        });
      },

      // History operations
      undo: () => {
        const { _history, name, links, joints, rootLinkId, materials } = get();
        if (_history.past.length === 0) return;

        const previous = _history.past[_history.past.length - 1];
        const currentData: RobotData = { name, links, joints, rootLinkId, materials };

        set((state) => {
          state.name = previous.name;
          state.links = previous.links;
          state.joints = previous.joints;
          state.rootLinkId = previous.rootLinkId;
          state.materials = previous.materials;
          state._history.past = state._history.past.slice(0, -1);
          state._history.future = [currentData, ...state._history.future];
        });
      },

      redo: () => {
        const { _history, name, links, joints, rootLinkId, materials } = get();
        if (_history.future.length === 0) return;

        const next = _history.future[0];
        const currentData: RobotData = { name, links, joints, rootLinkId, materials };

        set((state) => {
          state.name = next.name;
          state.links = next.links;
          state.joints = next.joints;
          state.rootLinkId = next.rootLinkId;
          state.materials = next.materials;
          state._history.past = [...state._history.past, currentData];
          state._history.future = state._history.future.slice(1);
        });
      },

      canUndo: () => get()._history.past.length > 0,
      canRedo: () => get()._history.future.length > 0,

      clearHistory: () => {
        set((state) => {
          state._history = { past: [], future: [] };
        });
      },

      // Computed values
      getJointAngles: () => {
        const angles: Record<string, number> = {};
        Object.values(get().joints).forEach((joint) => {
          if (joint.angle !== undefined) {
            angles[joint.name] = joint.angle;
          }
        });
        return angles;
      },

      getRootLink: () => {
        const state = get();
        return state.links[state.rootLinkId];
      },

      getLinkByName: (name) => {
        return Object.values(get().links).find((l) => l.name === name);
      },

      getJointByName: (name) => {
        return Object.values(get().joints).find((j) => j.name === name);
      },

      getChildJoints: (linkId) => {
        return Object.values(get().joints).filter((j) => j.parentLinkId === linkId);
      },

      getParentJoint: (linkId) => {
        return Object.values(get().joints).find((j) => j.childLinkId === linkId);
      },
    };
  })
);

// Selector hooks for common patterns
export const useRobotName = () => useRobotStore((state) => state.name);
export const useRobotLinks = () => useRobotStore((state) => state.links);
export const useRobotJoints = () => useRobotStore((state) => state.joints);
export const useRootLinkId = () => useRobotStore((state) => state.rootLinkId);
export const useCanUndo = () => useRobotStore((state) => state._history.past.length > 0);
export const useCanRedo = () => useRobotStore((state) => state._history.future.length > 0);
