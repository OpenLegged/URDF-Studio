/**
 * AI Assistant Feature
 *
 * Provides AI-powered robot generation, modification, and inspection capabilities.
 */

// Components
export { AIModal } from './components/AIModal'

// Services
export { generateRobotFromPrompt, runRobotInspection } from './services/aiService'

// Utilities
export {
  INSPECTION_CRITERIA,
  calculateItemScore,
  calculateCategoryScore,
  calculateOverallScore,
  getInspectionItem,
  getInspectionCategory
} from './utils/inspectionCriteria'

// Types
export type {
  AIResponse,
  InspectionItem,
  InspectionCategory,
  IssueType,
  InspectionIssue
} from './types'
