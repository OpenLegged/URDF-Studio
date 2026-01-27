/**
 * AI Service for robot generation, modification, and inspection
 */

import OpenAI from 'openai'
import type { RobotState, GeometryType, JointType, MotorSpec, InspectionReport } from '@/types'
import type { AIResponse, IssueType } from '../types'
import {
  INSPECTION_CRITERIA,
  calculateItemScore,
  calculateCategoryScore,
  calculateOverallScore,
  getInspectionItem
} from '../utils/inspectionCriteria'

/**
 * Helper to decode Base64 UTF-8 strings using TextDecoder
 */
const b64DecodeUnicode = (str: string): string => {
  try {
    const binaryString = atob(str)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return new TextDecoder().decode(bytes)
  } catch (e) {
    console.warn('Failed to decode base64 string', e)
    return ''
  }
}

// Encoded Easter Eggs (Key -> Value)
const EGGS: Record<string, string> = {
  '6L6+5aaZ56eR5oqA': '5Y+R5p2l6LS655S1',
  '54G16Laz5pe25Luj': '56Wd5L2g5oiQ5Yqf',
  '5Zug5YWL5pav5pm66IO9': '56Wd6ICB5p2/5aW95biF77yB',
  '6auY5pOO5py655S1': '5oiR54ix5bCP5rS+77yB',
  '5Zyw55Oc5py65LmZ5Lq6': '5Y+R5p2l54Oo5Zyw55Oc'
}

/**
 * Create OpenAI client instance
 */
const createOpenAIClient = (): OpenAI => {
  return new OpenAI({
    apiKey: process.env.API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    dangerouslyAllowBrowser: true
  })
}

/**
 * Get model name from environment
 */
const getModelName = (): string => {
  return process.env.OPENAI_MODEL || 'bce/deepseek-v3.2'
}

/**
 * Get simplified robot context for AI prompts
 */
const getContextRobot = (robot: RobotState) => {
  return {
    name: robot.name,
    links: Object.values(robot.links).map(l => ({
      id: l.id,
      name: l.name,
      mass: l.inertial.mass,
      inertia: l.inertial.inertia
    })),
    joints: Object.values(robot.joints).map(j => ({
      id: j.id,
      name: j.name,
      type: j.type,
      parent: j.parentLinkId,
      child: j.childLinkId,
      axis: j.axis
    })),
    rootId: robot.rootLinkId
  }
}

/**
 * Parse JSON from AI response with fallback strategies
 */
const parseJSONResponse = (content: string): { result: unknown; error?: string } => {
  // Try direct parsing
  try {
    return { result: JSON.parse(content) }
  } catch (parseError) {
    // Try extracting from markdown code blocks
    const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (jsonBlockMatch) {
      try {
        return { result: JSON.parse(jsonBlockMatch[1]) }
      } catch (e) {
        // Continue to next fallback
      }
    }

    // Try extracting JSON substring
    const firstOpen = content.indexOf('{')
    const lastClose = content.lastIndexOf('}')
    if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
      try {
        return { result: JSON.parse(content.substring(firstOpen, lastClose + 1)) }
      } catch (e) {
        // Continue to error
      }
    }

    return {
      result: null,
      error: `JSON 解析失败: ${(parseError as Error)?.message || '未知错误'}`
    }
  }
}

/**
 * Generate or modify robot from natural language prompt
 */
export const generateRobotFromPrompt = async (
  prompt: string,
  currentRobot: RobotState,
  motorLibrary: Record<string, MotorSpec[]>
): Promise<AIResponse | null> => {
  // Easter Egg Check
  const trimPrompt = prompt.trim()
  for (const [key, val] of Object.entries(EGGS)) {
    const decodedKey = b64DecodeUnicode(key)
    if (trimPrompt === decodedKey) {
      return {
        explanation: b64DecodeUnicode(val),
        actionType: 'advice'
      }
    }
  }

  if (!process.env.API_KEY) {
    console.error('API Key missing')
    console.error('Available env vars:', {
      API_KEY: process.env.API_KEY ? '***' : 'missing',
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
      OPENAI_MODEL: process.env.OPENAI_MODEL
    })
    return {
      explanation: 'API Key is missing. Please configure the environment.',
      actionType: 'advice'
    }
  }

  const openai = createOpenAIClient()
  const modelName = getModelName()

  console.log('[AI Service] Configuration:', {
    model: modelName,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    hasApiKey: !!process.env.API_KEY
  })

  // Simplify current robot state for context
  const contextRobot = {
    name: currentRobot.name,
    links: Object.values(currentRobot.links).map(l => ({
      id: l.id,
      name: l.name,
      visual: l.visual,
      inertial: l.inertial
    })),
    joints: Object.values(currentRobot.joints).map(j => ({
      id: j.id,
      name: j.name,
      type: j.type,
      parent: j.parentLinkId,
      child: j.childLinkId,
      origin: j.origin,
      axis: j.axis,
      limit: j.limit,
      hardware: j.hardware
    })),
    rootId: currentRobot.rootLinkId
  }

  const contextLibrary = Object.entries(motorLibrary).map(([brand, motors]) => ({
    brand,
    motors: motors.map(m => ({
      name: m.name,
      effort: m.effort,
      velocity: m.velocity,
      weight: m.armature
    }))
  }))

  const systemPrompt = `
  You are an expert Robotics Engineer and URDF Studio Expert.

  Your capabilities:
  1. **Generate**: Create new robot structures from scratch.
  2. **Modify**: specific parts of the existing robot (e.g., "Add a lidar to the base", "Make the legs longer", "Change joint 1 to use a Unitree motor").
  3. **Advice**: Analyze the robot and suggest improvements or hardware selection (e.g., "Is this motor strong enough?", "Calculate estimated torque").

  **Context Data:**
  - Current Robot Structure: ${JSON.stringify(contextRobot)}
  - Available Motor Library: ${JSON.stringify(contextLibrary)}

  **Instructions:**
  - If the user asks for a *new* robot, generate a complete new structure.
  - If the user asks to *modify*, return the FULL robot structure with the requested changes applied. Preserve existing IDs where possible.
  - If the user asks for *advice* or *hardware selection*, provide a text explanation. You can still return a modified robot if you want to apply the suggested hardware automatically (e.g. updating motorType and limits).
  - Use "cylinder" or "box" primitives for links.
  - Ensure parent/child relationships form a valid tree.
  - For hardware changes, use the exact 'motorType' names from the library.
  `

  try {
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      response_format: {
        type: 'json_object'
      },
      temperature: 0.7
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      console.error('No content in API response')
      return {
        explanation: 'API 返回了空内容，请重试。',
        actionType: 'advice' as const
      }
    }

    console.log('[AI Service] Raw response content:', content.substring(0, 200) + '...')

    const { result, error } = parseJSONResponse(content)
    if (!result) {
      return {
        explanation: `${error}\n\n原始响应: ${content.substring(0, 500)}`,
        actionType: 'advice' as const
      }
    }

    const parsedResult = result as Record<string, unknown>
    console.log('[AI Service] Parsed JSON result:', parsedResult)
    console.log('[AI Service] Result keys:', Object.keys(parsedResult))

    // Check multiple possible data locations
    const data = (parsedResult.robotData ||
      parsedResult.robot ||
      (parsedResult.links || parsedResult.joints ? parsedResult : null)) as Record<
      string,
      unknown
    > | null

    console.log('[AI Service] Extracted data:', data ? 'Found robot data' : 'No robot data')
    if (data) {
      console.log('[AI Service] Data keys:', Object.keys(data))
      console.log('[AI Service] Data content:', data)
    }

    // Extract explanation from various possible fields
    let explanationText = parsedResult.explanation as string | undefined
    if (!explanationText) {
      if (parsedResult.recommendation) {
        explanationText = parsedResult.recommendation as string
      } else if (parsedResult.analysis) {
        explanationText =
          typeof parsedResult.analysis === 'string'
            ? parsedResult.analysis
            : JSON.stringify(parsedResult.analysis)
      } else if (
        parsedResult.suggestions &&
        Array.isArray(parsedResult.suggestions) &&
        parsedResult.suggestions.length > 0
      ) {
        explanationText =
          '建议的电机选项：\n' +
          parsedResult.suggestions
            .map(
              (s: Record<string, unknown>, i: number) =>
                `${i + 1}. ${s.name || s.model || '未知'}: ${s.torque || s.effort || 'N/A'} Nm`
            )
            .join('\n')
      }
    }

    // Parse robot data back to State format
    let finalRobotState: Partial<RobotState> | undefined = undefined

    if (data) {
      const newLinks: Record<string, unknown> = {}
      const newJoints: Record<string, unknown> = {}

      // Handle links - support both array and object formats
      if (data.links) {
        let linksToProcess: unknown[] = []
        if (Array.isArray(data.links)) {
          linksToProcess = data.links
        } else if (typeof data.links === 'object') {
          linksToProcess = Object.values(data.links as Record<string, unknown>)
        }

        linksToProcess.forEach((l: unknown) => {
          const link = l as Record<string, unknown>
          if (!link || !link.id) {
            console.warn('[AI Service] Skipping invalid link:', link)
            return
          }

          // Handle different dimension formats
          let dimensions: { x: number; y: number; z: number }
          if (link.dimensions) {
            if (Array.isArray(link.dimensions)) {
              dimensions = {
                x: (link.dimensions[0] as number) || 0.1,
                y: (link.dimensions[1] as number) || 0.1,
                z: (link.dimensions[2] as number) || 0.1
              }
            } else if (typeof link.dimensions === 'object') {
              const dims = link.dimensions as Record<string, unknown>
              dimensions = {
                x: (dims.x as number) || (dims[0] as number) || 0.1,
                y: (dims.y as number) || (dims[1] as number) || 0.1,
                z: (dims.z as number) || (dims[2] as number) || 0.1
              }
            } else {
              dimensions = { x: 0.1, y: 0.1, z: 0.1 }
            }
          } else {
            dimensions = { x: 0.1, y: 0.1, z: 0.1 }
          }

          const visual = link.visual as Record<string, unknown> | undefined
          const visualType = ((link.visualType || visual?.type || 'box') as string) as GeometryType

          newLinks[link.id as string] = {
            id: link.id,
            name: link.name || link.id,
            inertial: {
              mass: link.mass || 1.0,
              inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.1, iyz: 0, izz: 0.1 }
            },
            visual: {
              type: visualType,
              dimensions: dimensions,
              color: link.color || visual?.color || '#3b82f6',
              origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } }
            },
            collision: {
              type: visualType,
              dimensions: dimensions,
              color: '#ef4444',
              origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } }
            }
          }
        })
      }

      // Handle joints - support both array and object formats
      if (data.joints) {
        let jointsToProcess: unknown[] = []
        if (Array.isArray(data.joints)) {
          jointsToProcess = data.joints
        } else if (typeof data.joints === 'object') {
          jointsToProcess = Object.values(data.joints as Record<string, unknown>)
        }

        jointsToProcess.forEach((j: unknown) => {
          const joint = j as Record<string, unknown>
          if (!joint || !joint.id) {
            console.warn('[AI Service] Skipping invalid joint:', joint)
            return
          }

          const origin = joint.origin as Record<string, unknown> | undefined
          const originXYZ = (joint.originXYZ || origin?.xyz) as number[] | Record<string, number> | undefined
          const originRPY = (joint.originRPY || origin?.rpy) as number[] | Record<string, number> | undefined
          const axis = joint.axis as number[] | Record<string, number> | undefined
          const limit = joint.limit as Record<string, number> | undefined

          newJoints[joint.id as string] = {
            id: joint.id,
            name: joint.name || joint.id,
            type: ((joint.type || 'fixed') as string) as JointType,
            parentLinkId: joint.parentLinkId || joint.parent,
            childLinkId: joint.childLinkId || joint.child,
            origin: {
              xyz: {
                x: Array.isArray(originXYZ) ? originXYZ[0] : originXYZ?.x ?? 0,
                y: Array.isArray(originXYZ) ? originXYZ[1] : originXYZ?.y ?? 0,
                z: Array.isArray(originXYZ) ? originXYZ[2] : originXYZ?.z ?? 0
              },
              rpy: {
                r: Array.isArray(originRPY) ? originRPY[0] : originRPY?.r ?? 0,
                p: Array.isArray(originRPY) ? originRPY[1] : originRPY?.p ?? 0,
                y: Array.isArray(originRPY) ? originRPY[2] : originRPY?.y ?? 0
              }
            },
            axis: {
              x: Array.isArray(axis) ? axis[0] : axis?.x ?? 0,
              y: Array.isArray(axis) ? axis[1] : axis?.y ?? 0,
              z: Array.isArray(axis) ? axis[2] : axis?.z ?? 1
            },
            limit: {
              lower: (joint.lowerLimit as number) ?? limit?.lower ?? -1.57,
              upper: (joint.upperLimit as number) ?? limit?.upper ?? 1.57,
              effort: (joint.effortLimit as number) ?? limit?.effort ?? 100,
              velocity: (joint.velocityLimit as number) ?? limit?.velocity ?? 10
            },
            dynamics: { damping: 0, friction: 0 },
            hardware: {
              armature: 0,
              motorType: (joint.motorType as string) || 'None',
              motorId: '',
              motorDirection: 1
            }
          }
        })
      }

      console.log('[AI Service] Processed links:', Object.keys(newLinks).length)
      console.log('[AI Service] Processed joints:', Object.keys(newJoints).length)

      finalRobotState = {
        name: (data.name as string) || 'modified_robot',
        links: newLinks as RobotState['links'],
        joints: newJoints as RobotState['joints'],
        rootLinkId: data.rootLinkId as string
      }
    }

    // Determine action type based on data presence
    let actionType: 'modification' | 'generation' | 'advice' =
      (parsedResult.actionType as 'modification' | 'generation' | 'advice') || 'advice'
    if (finalRobotState && (finalRobotState.links || finalRobotState.joints)) {
      actionType =
        (parsedResult.actionType as 'modification' | 'generation' | 'advice') ||
        (Object.keys(currentRobot.links).length === 0 ? 'generation' : 'modification')
    }

    // Use extracted explanation or generate one if missing
    let explanation = explanationText
    if (!explanation) {
      if (finalRobotState) {
        explanation = `已${actionType === 'generation' ? '生成' : '修改'}机器人结构。包含 ${Object.keys(finalRobotState.links || {}).length} 个链接和 ${Object.keys(finalRobotState.joints || {}).length} 个关节。`
      } else {
        explanation = 'AI 已处理您的请求，但未返回机器人数据。'
      }
    }

    console.log('[AI Service] Final response:', {
      explanation: explanation?.substring(0, 50) + '...',
      actionType,
      hasRobotData: !!finalRobotState
    })

    return {
      explanation: explanation,
      actionType: actionType,
      robotData: finalRobotState
    }
  } catch (e: unknown) {
    const error = e as { message?: string; status?: number; code?: string; response?: unknown }
    console.error('OpenAI API call failed', e)
    console.error('Error details:', {
      message: error?.message,
      status: error?.status,
      code: error?.code,
      response: error?.response
    })

    return {
      explanation: `API 调用失败: ${error?.message || '未知错误'}${error?.status ? ` (状态码: ${error.status})` : ''}`,
      actionType: 'advice' as const
    }
  }
}

/**
 * Run robot inspection with AI
 */
export const runRobotInspection = async (
  robot: RobotState,
  selectedItems?: Record<string, string[]>,
  lang: 'en' | 'zh' = 'en'
): Promise<InspectionReport | null> => {
  if (!process.env.API_KEY) {
    console.error('API Key missing')
    return {
      summary: 'API Key is missing. Please configure the environment.',
      issues: [
        {
          type: 'error',
          title: 'Configuration Error',
          description: 'API Key is missing. Please configure the environment.'
        }
      ]
    }
  }

  const openai = createOpenAIClient()
  const modelName = getModelName()
  const contextRobot = getContextRobot(robot)

  // Build evaluation criteria description (only include selected items)
  const criteriaDescription = INSPECTION_CRITERIA.map(category => {
    const selectedItemIds = selectedItems?.[category.id] || []
    if (selectedItemIds.length === 0) return null

    const categoryName = lang === 'zh' ? category.nameZh : category.name
    const itemsDesc = category.items
      .filter(item => selectedItemIds.includes(item.id))
      .map(item => {
        const itemName = lang === 'zh' ? item.nameZh : item.name
        const itemDesc = lang === 'zh' ? item.descriptionZh : item.description
        return `    - ${itemName} (${item.id}): ${itemDesc}`
      })
      .join('\n')

    if (itemsDesc) {
      return `  ${category.id} (${categoryName}, weight: ${category.weight * 100}%):\n${itemsDesc}`
    }
    return null
  })
    .filter(Boolean)
    .join('\n\n')

  const languageInstruction =
    lang === 'zh'
      ? '请使用中文生成所有报告内容，包括总结、问题标题和描述。'
      : 'Please generate all report content in English, including summary, issue titles and descriptions.'

  const systemPrompt =
    lang === 'zh'
      ? `
  你是一位专业的URDF机器人检查专家。你的工作是分析提供的机器人结构，识别潜在的错误、警告和改进建议。

  **评估标准:**
${criteriaDescription}

  **评分指南:**
  - 对于每个检查项，分配一个分数（0-10）：
    - 发现错误：0-3分
    - 发现警告：4-6分
    - 建议/改进：7-9分
    - 通过（无问题）：10分

  **输出格式:**
  返回一个纯JSON对象，结构如下：
  {
    "summary": "总体检查总结（使用中文）",
    "issues": [
      {
        "type": "error" | "warning" | "suggestion",
        "title": "问题标题（使用中文）",
        "description": "详细描述（使用中文）",
        "category": "category_id (例如: 'physical', 'kinematics', 'naming', 'symmetry', 'hardware')",
        "itemId": "item_id (例如: 'mass_check', 'axis_zero')",
        "score": 0-10,
        "relatedIds": ["link_id1", "joint_id1"]
      }
    ]
  }

  **重要提示:**
  - 每个问题必须包含与上述标准匹配的 'category' 和 'itemId' 字段
  - 根据严重程度分配适当的分数
  - 当问题特定于某些链接/关节时，包含 relatedIds
  - ${languageInstruction}
  `
      : `
  You are an expert URDF Robot Inspector. Your job is to analyze the provided robot structure and identify potential errors, warnings, and improvements.

  **EVALUATION CRITERIA:**
${criteriaDescription}

  **SCORING GUIDELINES:**
  - For each check item, assign a score (0-10):
    - Error found: 0-3 points
    - Warning found: 4-6 points
    - Suggestion/improvement: 7-9 points
    - Pass (no issues): 10 points

  **OUTPUT FORMAT:**
  Return a pure JSON object with the following structure:
  {
    "summary": "Overall inspection summary",
    "issues": [
      {
        "type": "error" | "warning" | "suggestion",
        "title": "Issue title",
        "description": "Detailed description",
        "category": "category_id (e.g., 'physical', 'kinematics', 'naming', 'symmetry', 'hardware')",
        "itemId": "item_id (e.g., 'mass_check', 'axis_zero')",
        "score": 0-10,
        "relatedIds": ["link_id1", "joint_id1"]
      }
    ]
  }

  **IMPORTANT:**
  - Each issue MUST include 'category' and 'itemId' fields matching the criteria above
  - Assign appropriate scores based on severity
  - Include relatedIds when the issue is specific to certain links/joints
  - ${languageInstruction}
  `

  try {
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Inspect this robot structure:\n${JSON.stringify(contextRobot)}` }
      ],
      response_format: {
        type: 'json_object'
      },
      temperature: 0.7
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      return {
        summary: 'Failed to get inspection response.',
        issues: [
          {
            type: 'error',
            title: 'Inspection Error',
            description: 'The AI service returned empty content.'
          }
        ]
      }
    }

    console.log('[Inspection] Raw response content:', content.substring(0, 200) + '...')

    const { result, error } = parseJSONResponse(content)
    if (!result) {
      return {
        summary: 'Failed to parse inspection results.',
        issues: [
          {
            type: 'error',
            title: 'Parse Error',
            description: `${error}\n\n原始响应: ${content.substring(0, 500)}`
          }
        ]
      }
    }

    const parsedResult = result as { summary?: string; issues?: unknown[] }

    // Process returned issues, ensure scoring info is included
    const issues = ((parsedResult.issues || []) as Record<string, unknown>[]).map(issue => {
      // If no score, calculate based on type
      if (issue.score === undefined) {
        issue.score = calculateItemScore(issue.type as IssueType, true)
      }
      // Ensure category and itemId exist
      if (!issue.category) {
        const title = (issue.title as string)?.toLowerCase() || ''
        if (title.includes('mass') || title.includes('inertia')) {
          issue.category = 'physical'
        } else if (title.includes('axis') || title.includes('joint')) {
          issue.category = 'kinematics'
        } else if (title.includes('name')) {
          issue.category = 'naming'
        } else if (title.includes('symmetry') || title.includes('left') || title.includes('right')) {
          issue.category = 'symmetry'
        } else if (title.includes('motor') || title.includes('hardware')) {
          issue.category = 'hardware'
        }
      }
      return issue
    })

    // Generate complete list for all selected check items, including passed items
    const allIssues: typeof issues = [...issues]
    const reportedItems = new Set<string>()

    // Record reported items
    issues.forEach(issue => {
      if (issue.category && issue.itemId) {
        reportedItems.add(`${issue.category}:${issue.itemId}`)
      }
    })

    // Create passed items for selected but not reported items
    if (selectedItems) {
      Object.keys(selectedItems).forEach(categoryId => {
        const selectedItemIds = selectedItems[categoryId] || []
        selectedItemIds.forEach(itemId => {
          const key = `${categoryId}:${itemId}`
          if (!reportedItems.has(key)) {
            const item = getInspectionItem(categoryId, itemId)
            if (item) {
              const itemName = lang === 'zh' ? item.nameZh : item.name
              const itemDesc = lang === 'zh' ? item.descriptionZh : item.description
              allIssues.push({
                type: 'pass',
                title: lang === 'zh' ? `${itemName} - 通过` : `${itemName} - Passed`,
                description:
                  lang === 'zh'
                    ? `该检查项已通过：${itemDesc}`
                    : `This check item passed: ${itemDesc}`,
                category: categoryId,
                itemId: itemId,
                score: 10
              })
            }
          }
        })
      })
    }

    // Calculate category scores
    const categoryScores: Record<string, number[]> = {}
    INSPECTION_CRITERIA.forEach(category => {
      categoryScores[category.id] = []
    })

    // Collect scores for each category
    allIssues.forEach(issue => {
      if (issue.category && issue.score !== undefined) {
        if (!categoryScores[issue.category as string]) {
          categoryScores[issue.category as string] = []
        }
        categoryScores[issue.category as string].push(issue.score as number)
      }
    })

    // Calculate average score for each category
    const categoryScoreMap: Record<string, number> = {}
    Object.keys(categoryScores).forEach(categoryId => {
      const scores = categoryScores[categoryId]
      if (scores.length > 0) {
        categoryScoreMap[categoryId] = calculateCategoryScore(scores)
      } else {
        categoryScoreMap[categoryId] = 10
      }
    })

    // Collect all item scores for total calculation
    const allItemScores: number[] = []
    allIssues.forEach(issue => {
      if (issue.score !== undefined) {
        allItemScores.push(issue.score as number)
      }
    })

    // Calculate total score
    const overallScore = calculateOverallScore(categoryScoreMap, allItemScores)

    // Calculate max score
    const maxScore = allItemScores.length > 0 ? allItemScores.length * 10 : 100

    return {
      summary: parsedResult.summary || 'Inspection completed.',
      issues: allIssues as InspectionReport['issues'],
      overallScore: Math.round(overallScore * 10) / 10,
      categoryScores: categoryScoreMap,
      maxScore: maxScore
    } as InspectionReport
  } catch (e: unknown) {
    const error = e as { message?: string }
    console.error('Inspection failed', e)
    return {
      summary: 'Failed to complete inspection due to an AI error.',
      issues: [
        {
          type: 'error',
          title: 'Inspection Error',
          description: `The AI service could not process the request: ${error?.message || 'unknown error'}`
        }
      ]
    }
  }
}
