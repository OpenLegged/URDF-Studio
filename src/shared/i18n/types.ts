/**
 * i18n Types
 */

export type Language = 'en' | 'zh';

export interface TranslationKeys {
  // Header
  appName: string;
  skeleton: string;
  detail: string;
  hardware: string;
  aiAssistant: string;
  file: string;
  import: string;
  importFolder: string;
  export: string;

  // Tree Editor
  robotName: string;
  structure: string;
  addChildLink: string;
  addChildJoint: string;
  deleteBranch: string;

  // Property Editor
  properties: string;
  selectLinkOrJoint: string;
  name: string;
  visualGeometry: string;
  collisionGeometry: string;
  type: string;
  dimensions: string;
  originRelativeLink: string;
  originRelativeParent: string;
  position: string;
  rotation: string;
  roll: string;
  pitch: string;
  yaw: string;
  color: string;
  meshLibrary: string;
  upload: string;
  selected: string;
  inertial: string;
  mass: string;
  centerOfMass: string;
  inertiaTensor: string;
  kinematics: string;
  axisRotation: string;
  hardwareConfig: string;
  motorSource: string;
  brand: string;
  model: string;
  viewMotor: string;
  customType: string;
  motorId: string;
  direction: string;
  normal: string;
  inverted: string;
  armature: string;
  limits: string;
  lower: string;
  upper: string;
  velocity: string;
  effort: string;
  dynamics: string;
  friction: string;
  damping: string;
  none: string;
  library: string;
  custom: string;
  autoAlign: string;
  box: string;
  cylinder: string;
  sphere: string;
  mesh: string;
  width: string;
  depth: string;
  height: string;
  radius: string;

  // Visualizer
  skeletonOptions: string;
  detailOptions: string;
  hardwareOptions: string;
  move: string;
  rotate: string;
  showGeometry: string;
  showLabels: string;
  showJointAxes: string;
  jointAxisSize: string;
  frameSize: string;
  labelScale: string;
  showOrigin: string;
  showCollision: string;
  instruction: string;
  instructionWin: string;
  instructionMac: string;
  clickToSelect: string;
  enableLabels: string;
  clickLabels: string;
  confirmTransformation: string;
  apply: string;

  // AI Inspector
  aiTitle: string;
  aiIntro: string;
  aiExamples: string;
  aiPlaceholder: string;
  yourRequest: string;
  aiResponse: string;
  actionWarning: string;
  back: string;
  applyChanges: string;
  cancel: string;
  send: string;
  runInspection: string;
  thinking: string;
  inspectorSummary: string;
  overallScore: string;
  downloadReport: string;
  downloadReportPDF: string;
  inspectionItems: string;
  retestItem: string;
  chatTitle: string;
  chatPlaceholder: string;
  chatWithAI: string;
  processing: string;
  askAboutReport: string;
  checking: string;
  inspectionCompleted: string;
  generatingReport: string;

  // Additional UI
  collapseSidebar: string;
  switchUnit: string;
  showJointControls: string;
  showVisual: string;
  showCenterOfMass: string;
  showInertia: string;
  jointControls: string;
  viewOptions: string;
  loadingRobot: string;
  enterRobotName: string;
  enterMotorType: string;
  modeLabel: string;
  highlightMode: string;
  linkMode: string;
  collisionMode: string;
  toolbox: string;
  robotRedirect: string;
  trajectoryEditing: string;
  featureInDevelopment: string;
  transformMode: string;
  translateMode: string;
  rotateMode: string;
  universalMode: string;
  selectMode: string;
  viewMode: string;
  faceMode: string;
  measureMode: string;
  closeToolbar: string;

  // Toolbox Descriptions
  aiAssistantDesc: string;
  motionTrackingDesc: string;
  trajectoryEditingDesc: string;
  bridgedpEngine: string;
  bridgedpEngineDesc: string;

  // Additional UI Elements
  gizmos: string;
  size: string;
  resetJoints: string;
  expand: string;
  collapse: string;
  close: string;
  confirm: string;
  confirmEnter: string;
  cancelEsc: string;
  visual: string;
  collision: string;
  hide: string;
  show: string;
  hideVisualCollision: string;
  showVisualCollision: string;
  hideAllVisuals: string;
  showAllVisuals: string;
  copyToClipboard: string;
  copy: string;
  copied: string;
  fileBrowser: string;
  dropOrImport: string;
}

export type Translations = Record<Language, TranslationKeys>;
