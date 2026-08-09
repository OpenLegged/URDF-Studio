export const radiansToDegrees = (value: number): number => {
  return (value * 180) / Math.PI;
};

export const angularDriveGainToUsdUnits = (value: number): number => {
  return (Math.PI / 180) * value;
};

export const angularVelocityToUsdUnits = (value: number): number => {
  return radiansToDegrees(value);
};

export const resolveIsaacSimDriveGain = (
  sourceGain: number | null,
  defaultGain: number | null,
  shouldConvertAngularDriveGains: boolean,
): number | null => {
  const authoredSourceGain =
    sourceGain !== null && shouldConvertAngularDriveGains
      ? angularDriveGainToUsdUnits(sourceGain)
      : sourceGain;
  if (defaultGain === null) {
    return authoredSourceGain;
  }
  if (authoredSourceGain === null) {
    return defaultGain;
  }
  return Math.max(authoredSourceGain, defaultGain);
};

export const getUsdDriveInstanceName = (typeName: string): 'angular' | 'linear' | null => {
  if (typeName === 'PhysicsRevoluteJoint') {
    return 'angular';
  }
  if (typeName === 'PhysicsPrismaticJoint') {
    return 'linear';
  }
  return null;
};