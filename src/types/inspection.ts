/**
 * AI inspection related types
 */

export interface InspectionIssue {
  type: 'error' | 'warning' | 'suggestion' | 'pass';
  title: string;
  description: string;
  relatedIds?: string[]; // IDs of links/joints involved
  category?: string; // Category ID
  itemId?: string; // Check item ID
  score?: number; // Score (0-10)
}

export interface InspectionReport {
  summary: string;
  issues: InspectionIssue[];
  overallScore?: number; // Total score (0-100)
  categoryScores?: Record<string, number>; // Category scores
  maxScore?: number; // Max score (default 100)
}
