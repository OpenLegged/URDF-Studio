/**
 * AI Assistant Feature Types
 */

import type { RobotState } from '@/types'

/**
 * AI response structure
 */
export interface AIResponse {
  explanation: string
  actionType: 'modification' | 'generation' | 'advice'
  robotData?: Partial<RobotState>
}

/**
 * Inspection item definition
 */
export interface InspectionItem {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  maxScore: number
}

/**
 * Inspection category definition
 */
export interface InspectionCategory {
  id: string
  name: string
  nameZh: string
  weight: number
  items: InspectionItem[]
}

/**
 * Issue types for inspection
 */
export type IssueType = 'error' | 'warning' | 'suggestion' | 'pass'

/**
 * Inspection issue
 */
export interface InspectionIssue {
  type: IssueType
  title: string
  description: string
  category?: string
  itemId?: string
  score?: number
  relatedIds?: string[]
}
