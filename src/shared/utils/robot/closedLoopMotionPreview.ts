import { resolveClosedLoopDrivenJointMotion } from '@/core/robot';
import type { ClosedLoopDrivenJointMotionResult } from '@/core/robot/closedLoops';
import type { JointQuaternion, RobotState } from '@/types';
import { resolveClosedLoopDrivenJointMotionWithWorker } from './closedLoopMotionPreviewWorkerBridge';
import type {
  ClosedLoopMotionPreviewRobot,
  ClosedLoopMotionPreviewState,
  ClosedLoopMotionPreviewWorkerSolve,
  ClosedLoopMotionPreviewWorkerSolveOptions,
} from './closedLoopMotionPreviewContract';

export type {
  ClosedLoopMotionPreviewRobot,
  ClosedLoopMotionPreviewState,
  ClosedLoopMotionPreviewWorkerSolve,
  ClosedLoopMotionPreviewWorkerSolveOptions,
} from './closedLoopMotionPreviewContract';

const CLOSED_LOOP_PREVIEW_SOLVE_OPTIONS: ClosedLoopMotionPreviewWorkerSolveOptions = {
  maxIterations: 12,
  tolerance: 1e-5,
};

export interface ClosedLoopMotionPreviewResult extends ClosedLoopMotionPreviewState {
  appliedAngle: number | null;
  constrained: boolean;
}

export interface ClosedLoopMotionPreviewSession {
  setBaseRobot: (robot: ClosedLoopMotionPreviewRobot | null) => void;
  solve: (jointId: string, angle: number) => ClosedLoopMotionPreviewResult;
  reset: () => void;
}

export interface AsyncClosedLoopMotionPreviewSession {
  setBaseRobot: (robot: ClosedLoopMotionPreviewRobot | null) => void;
  solve: (jointId: string, angle: number) => Promise<ClosedLoopMotionPreviewResult>;
  reset: () => void;
}

function isSameAngle(left: number | undefined, right: number | undefined): boolean {
  if (typeof left !== 'number' || typeof right !== 'number') {
    return left === right;
  }

  return Math.abs(left - right) <= 1e-6;
}

function isSameQuaternion(
  left: JointQuaternion | undefined,
  right: JointQuaternion | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    isSameAngle(left.x, right.x) &&
    isSameAngle(left.y, right.y) &&
    isSameAngle(left.z, right.z) &&
    isSameAngle(left.w, right.w)
  );
}

export function buildClosedLoopMotionPreviewRobot(
  robot: ClosedLoopMotionPreviewRobot,
  previewState: ClosedLoopMotionPreviewState,
): ClosedLoopMotionPreviewRobot {
  const seededRobot = structuredClone(robot);

  Object.entries(previewState.angles).forEach(([jointId, angle]) => {
    if (seededRobot.joints[jointId]) {
      seededRobot.joints[jointId].angle = angle;
    }
  });

  Object.entries(previewState.quaternions).forEach(([jointId, quaternion]) => {
    if (seededRobot.joints[jointId]) {
      seededRobot.joints[jointId].quaternion = quaternion;
    }
  });

  return seededRobot;
}

export function resolveClosedLoopJointMotionPreview(
  robot: ClosedLoopMotionPreviewRobot,
  jointId: string,
  angle: number,
  previewState: ClosedLoopMotionPreviewState,
): ClosedLoopMotionPreviewResult {
  const seededRobot = buildClosedLoopMotionPreviewRobot(robot, previewState);
  const solution = resolveClosedLoopDrivenJointMotion(
    seededRobot,
    jointId,
    angle,
    CLOSED_LOOP_PREVIEW_SOLVE_OPTIONS,
  );

  return {
    angles: solution.angles,
    quaternions: solution.quaternions,
    appliedAngle: solution.appliedAngle,
    constrained: solution.constrained,
  };
}

function collectClosedLoopMotionPreviewState(
  baseRobot: Pick<RobotState, 'joints'>,
  workingRobot: Pick<RobotState, 'joints'>,
): ClosedLoopMotionPreviewState {
  const angles: Record<string, number> = {};
  const quaternions: Record<string, JointQuaternion> = {};

  Object.entries(workingRobot.joints).forEach(([jointId, joint]) => {
    const baseJoint = baseRobot.joints[jointId];
    if (!baseJoint) {
      return;
    }

    if (typeof joint.angle === 'number' && !isSameAngle(joint.angle, baseJoint.angle)) {
      angles[jointId] = joint.angle;
    }

    if (joint.quaternion && !isSameQuaternion(joint.quaternion, baseJoint.quaternion)) {
      quaternions[jointId] = joint.quaternion;
    }
  });

  return { angles, quaternions };
}

function applyClosedLoopMotionSolution(
  workingRobot: ClosedLoopMotionPreviewRobot,
  solution: ClosedLoopDrivenJointMotionResult,
): void {
  Object.entries(solution.angles).forEach(([compensatedJointId, compensatedAngle]) => {
    if (workingRobot.joints[compensatedJointId]) {
      workingRobot.joints[compensatedJointId].angle = compensatedAngle;
    }
  });

  Object.entries(solution.quaternions).forEach(([compensatedJointId, compensatedQuaternion]) => {
    if (workingRobot.joints[compensatedJointId]) {
      workingRobot.joints[compensatedJointId].quaternion = compensatedQuaternion;
    }
  });
}

function cloneClosedLoopMotionPreviewState(
  state: ClosedLoopMotionPreviewState,
): ClosedLoopMotionPreviewState {
  return {
    angles: { ...state.angles },
    quaternions: { ...state.quaternions },
  };
}

function createEmptyClosedLoopMotionPreviewState(): ClosedLoopMotionPreviewState {
  return {
    angles: {},
    quaternions: {},
  };
}

function setPreviewStateAngle(
  baseRobot: Pick<RobotState, 'joints'>,
  state: ClosedLoopMotionPreviewState,
  jointId: string,
  angle: number,
): void {
  const baseJoint = baseRobot.joints[jointId];
  if (!baseJoint || isSameAngle(baseJoint.angle, angle)) {
    delete state.angles[jointId];
    return;
  }

  state.angles[jointId] = angle;
}

function setPreviewStateQuaternion(
  baseRobot: Pick<RobotState, 'joints'>,
  state: ClosedLoopMotionPreviewState,
  jointId: string,
  quaternion: JointQuaternion,
): void {
  const baseJoint = baseRobot.joints[jointId];
  if (!baseJoint || isSameQuaternion(baseJoint.quaternion, quaternion)) {
    delete state.quaternions[jointId];
    return;
  }

  state.quaternions[jointId] = quaternion;
}

function applyClosedLoopMotionSolutionToPreviewState(
  baseRobot: Pick<RobotState, 'joints'>,
  state: ClosedLoopMotionPreviewState,
  solution: ClosedLoopDrivenJointMotionResult,
): ClosedLoopMotionPreviewState {
  const nextState = cloneClosedLoopMotionPreviewState(state);

  Object.entries(solution.angles).forEach(([jointId, angle]) => {
    setPreviewStateAngle(baseRobot, nextState, jointId, angle);
  });

  Object.entries(solution.quaternions).forEach(([jointId, quaternion]) => {
    setPreviewStateQuaternion(baseRobot, nextState, jointId, quaternion);
  });

  return nextState;
}

export function createClosedLoopMotionPreviewSession(): ClosedLoopMotionPreviewSession {
  let baseRobot: ClosedLoopMotionPreviewRobot | null = null;
  let workingRobot: ClosedLoopMotionPreviewRobot | null = null;

  const resetWorkingRobot = () => {
    workingRobot = baseRobot ? structuredClone(baseRobot) : null;
  };

  return {
    setBaseRobot(robot) {
      if (baseRobot === robot) {
        return;
      }

      baseRobot = robot;
      resetWorkingRobot();
    },

    solve(jointId, angle) {
      if (!baseRobot) {
        return { angles: {}, quaternions: {}, appliedAngle: null, constrained: false };
      }

      if (!workingRobot) {
        resetWorkingRobot();
      }

      if (!workingRobot || !workingRobot.joints[jointId]) {
        return { angles: {}, quaternions: {}, appliedAngle: null, constrained: false };
      }

      const solution = resolveClosedLoopDrivenJointMotion(
        workingRobot,
        jointId,
        angle,
        CLOSED_LOOP_PREVIEW_SOLVE_OPTIONS,
      );

      applyClosedLoopMotionSolution(workingRobot, solution);

      return {
        ...collectClosedLoopMotionPreviewState(baseRobot, workingRobot),
        appliedAngle: solution.appliedAngle,
        constrained: solution.constrained,
      };
    },

    reset() {
      resetWorkingRobot();
    },
  };
}

export function createClosedLoopMotionPreviewWorkerSession(
  solveWithWorker: ClosedLoopMotionPreviewWorkerSolve = resolveClosedLoopDrivenJointMotionWithWorker,
): AsyncClosedLoopMotionPreviewSession {
  let baseRobot: ClosedLoopMotionPreviewRobot | null = null;
  let previewState: ClosedLoopMotionPreviewState = createEmptyClosedLoopMotionPreviewState();
  let resetGeneration = 0;
  let solveRequestSerial = 0;
  let lastAppliedRequestSerial = 0;

  const resetWorkingRobot = () => {
    resetGeneration += 1;
    lastAppliedRequestSerial = solveRequestSerial;
    previewState = createEmptyClosedLoopMotionPreviewState();
  };

  return {
    setBaseRobot(robot) {
      if (baseRobot === robot) {
        return;
      }

      baseRobot = robot;
      resetWorkingRobot();
    },

    async solve(jointId, angle) {
      if (!baseRobot) {
        return { angles: {}, quaternions: {}, appliedAngle: null, constrained: false };
      }

      if (!baseRobot.joints[jointId]) {
        return { angles: {}, quaternions: {}, appliedAngle: null, constrained: false };
      }

      const requestGeneration = resetGeneration;
      const requestSerial = ++solveRequestSerial;
      const requestPreviewState = cloneClosedLoopMotionPreviewState(previewState);
      const solution = await solveWithWorker(
        baseRobot,
        jointId,
        angle,
        CLOSED_LOOP_PREVIEW_SOLVE_OPTIONS,
        requestPreviewState,
      );

      if (requestGeneration !== resetGeneration || !baseRobot) {
        return { angles: {}, quaternions: {}, appliedAngle: null, constrained: false };
      }

      const nextPreviewState = applyClosedLoopMotionSolutionToPreviewState(
        baseRobot,
        requestPreviewState,
        solution,
      );
      if (requestSerial > lastAppliedRequestSerial) {
        previewState = nextPreviewState;
        lastAppliedRequestSerial = requestSerial;
      }

      return {
        ...cloneClosedLoopMotionPreviewState(nextPreviewState),
        appliedAngle: solution.appliedAngle,
        constrained: solution.constrained,
      };
    },

    reset() {
      resetWorkingRobot();
    },
  };
}
