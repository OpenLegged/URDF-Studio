import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(new URL('../../../../', import.meta.url).pathname)

const runtimeFiles = [
  'src/features/ai-assistant/components/AIInspectionModal.tsx',
  'src/features/ai-assistant/components/InspectionSidebar.tsx',
  'src/features/ai-assistant/components/InspectionSetupNormalView.tsx',
  'src/features/ai-assistant/components/InspectionSetupView.tsx',
  'src/features/ai-assistant/components/InspectionReport.tsx',
  'src/features/ai-assistant/hooks/useInspectionExecution.ts',
  'src/features/ai-assistant/hooks/useInspectionReport.ts',
  'src/features/ai-assistant/services/aiService.ts',
  'src/features/ai-assistant/utils/processInspectionResults.ts',
  'src/features/ai-assistant/utils/buildConversationContext.ts',
  'src/features/ai-assistant/utils/buildInspectionPromptNotes.ts',
  'src/features/ai-assistant/utils/inspectionEvidence.ts',
  'src/features/file-io/components/InspectionReportTemplate.tsx',
]

test('new AI inspection runtime does not import the legacy criteria or mapping standard', () => {
  runtimeFiles.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

    assert.doesNotMatch(source, /INSPECTION_CRITERIA/, relativePath)
    assert.doesNotMatch(source, /inspectionCriteria/, relativePath)
    assert.doesNotMatch(source, /inspectionProfileMapping/, relativePath)
  })
})

test('new AI inspection runtime does not emit legacy report fields', () => {
  runtimeFiles.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

    assert.doesNotMatch(source, /legacyCategoryId/, relativePath)
    assert.doesNotMatch(source, /legacyItemId/, relativePath)
    assert.doesNotMatch(source, /categoryScores/, relativePath)
  })
})
