/**
 * Hardware configuration related types
 */

export interface MotorSpec {
  name: string;
  armature: number;
  velocity: number;
  effort: number;
  url?: string;
  description?: string;
}
