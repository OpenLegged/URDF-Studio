
import OpenAI from "openai";
import { RobotState, GeometryType, JointType, MotorSpec, InspectionReport } from '../types';
import { INSPECTION_CRITERIA, calculateItemScore, calculateCategoryScore, calculateOverallScore, getInspectionItem } from './inspectionCriteria';

interface AIResponse {
  explanation: string;
  actionType: 'modification' | 'generation' | 'advice';
  robotData?: Partial<RobotState>;
}

// Helper to decode Base64 UTF-8 strings using TextDecoder
const b64DecodeUnicode = (str: string) => {
  try {
    const binaryString = atob(str);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    console.warn("Failed to decode base64 string", e);
    return "";
  }
};

// Encoded Easter Eggs (Key -> Value)
// Keys must be exact matches of the user prompt
const EGGS: Record<string, string> = {
  "6L6+5aaZ56eR5oqA": "5Y+R5p2l6LS655S1", // 达妙科技 
  "54G16Laz5pe25Luj": "56Wd5L2g5oiQ5Yqf", 
  "5Zug5YWL5pav5pm66IO9": "56Wd6ICB5p2/5aW95biF77yB", 
  "6auY5pOO5py655S1": "5oiR54ix5bCP5rS+77yB", 
  "5Zyw55Oc5py65LmZ5Lq6": "5Y+R5p2l54Oo5Zyw55Oc" 
};

export const generateRobotFromPrompt = async (
  prompt: string, 
  currentRobot: RobotState,
  motorLibrary: Record<string, MotorSpec[]>
): Promise<AIResponse | null> => {
  
  // Easter Egg Check
  const trimPrompt = prompt.trim();
  for (const [key, val] of Object.entries(EGGS)) {
      const decodedKey = b64DecodeUnicode(key);
      if (trimPrompt === decodedKey) {
          return {
              explanation: b64DecodeUnicode(val),
              actionType: 'advice'
          };
      }
  }

  if (!process.env.API_KEY) {
    console.error("API Key missing");
    console.error("Available env vars:", {
      API_KEY: process.env.API_KEY ? '***' : 'missing',
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
      OPENAI_MODEL: process.env.OPENAI_MODEL
    });
    return {
        explanation: "API Key is missing. Please configure the environment.",
        actionType: 'advice'
    };
  }

  const openai = new OpenAI({ 
    apiKey: process.env.API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    dangerouslyAllowBrowser: true // 允许在浏览器中使用，因为我们使用代理服务器
  });

  const modelName = process.env.OPENAI_MODEL || 'bce/deepseek-v3.2';
  console.log('[AI Service] Configuration:', {
    model: modelName,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    hasApiKey: !!process.env.API_KEY
  });

  // Simplify current robot state for context (remove heavy UI stuff if any, keep structure)
  const contextRobot = {
      name: currentRobot.name,
      links: Object.values(currentRobot.links).map(l => ({
          id: l.id, name: l.name, visual: l.visual, inertial: l.inertial
      })),
      joints: Object.values(currentRobot.joints).map(j => ({
          id: j.id, name: j.name, type: j.type, parent: j.parentLinkId, child: j.childLinkId, 
          origin: j.origin, axis: j.axis, limit: j.limit, hardware: j.hardware
      })),
      rootId: currentRobot.rootLinkId
  };

  const contextLibrary = Object.entries(motorLibrary).map(([brand, motors]) => ({
      brand,
      motors: motors.map(m => ({ name: m.name, effort: m.effort, velocity: m.velocity, weight: m.armature })) // simplified specs
  }));

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
  `;

  // Schema definition
  // Schema definition for OpenAI structured output (not used with json_object format, but kept for reference)
  // Note: OpenAI json_object format doesn't use strict schema validation

  try {
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      response_format: { 
        type: "json_object"
      },
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error("No content in API response");
      return {
        explanation: "API 返回了空内容，请重试。",
        actionType: 'advice' as const
      };
    }
    
    console.log("[AI Service] Raw response content:", content.substring(0, 200) + "...");
    
    // Parse JSON response
    let result;
    try {
      result = JSON.parse(content);
      console.log("[AI Service] Parsed JSON result:", result);
      console.log("[AI Service] Result keys:", Object.keys(result));
    } catch (parseError: any) {
      console.error("Failed to parse JSON response", parseError);
      console.error("Content that failed to parse:", content);
      
      // Fallback: try to extract JSON from markdown code blocks
      const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) {
        try {
          result = JSON.parse(jsonBlockMatch[1]);
        } catch (e) {
          console.error("Failed to parse JSON from code block", e);
        }
      }
      
      if (!result) {
        const firstOpen = content.indexOf('{');
        const lastClose = content.lastIndexOf('}');
        if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
          try {
            result = JSON.parse(content.substring(firstOpen, lastClose + 1));
          } catch (e) {
            console.error("Failed to parse JSON from extracted substring", e);
          }
        }
      }
      
      if (!result) {
        return {
          explanation: `JSON 解析失败: ${parseError?.message || '未知错误'}\n\n原始响应: ${content.substring(0, 500)}`,
          actionType: 'advice' as const
        };
      }
    }
    
    // Check multiple possible data locations
    // Support formats: {robotData: {...}}, {robot: {...}}, {links: [...], joints: [...]}, or direct robot structure
    const data = result.robotData || result.robot || (result.links || result.joints ? result : null);
    
    console.log("[AI Service] Extracted data:", data ? "Found robot data" : "No robot data");
    if (data) {
      console.log("[AI Service] Data keys:", Object.keys(data));
      console.log("[AI Service] Data content:", data);
    }
    
    // Extract explanation from various possible fields
    let explanationText = result.explanation;
    if (!explanationText) {
      // Try to build explanation from recommendation, analysis, or suggestions
      if (result.recommendation) {
        explanationText = result.recommendation;
      } else if (result.analysis) {
        explanationText = typeof result.analysis === 'string' ? result.analysis : JSON.stringify(result.analysis);
      } else if (result.suggestions && Array.isArray(result.suggestions) && result.suggestions.length > 0) {
        explanationText = "建议的电机选项：\n" + result.suggestions.map((s: any, i: number) => 
          `${i + 1}. ${s.name || s.model || '未知'}: ${s.torque || s.effort || 'N/A'} Nm`
        ).join('\n');
      }
    }

    // If there is data, parse it back to our full State format
    let finalRobotState: Partial<RobotState> | undefined = undefined;

    if (data) {
        const newLinks: Record<string, any> = {};
        const newJoints: Record<string, any> = {};

        // Handle links - support both array and object formats
        if (data.links) {
            let linksToProcess: any[] = [];
            if (Array.isArray(data.links)) {
                linksToProcess = data.links;
            } else if (typeof data.links === 'object') {
                // Convert object to array
                linksToProcess = Object.values(data.links);
            }
            
            linksToProcess.forEach((l: any) => {
                if (!l || !l.id) {
                    console.warn('[AI Service] Skipping invalid link:', l);
                    return;
                }
                
                // Handle different dimension formats
                let dimensions: { x: number, y: number, z: number };
                if (l.dimensions) {
                    if (Array.isArray(l.dimensions)) {
                        dimensions = { x: l.dimensions[0] || 0.1, y: l.dimensions[1] || 0.1, z: l.dimensions[2] || 0.1 };
                    } else if (typeof l.dimensions === 'object') {
                        dimensions = { 
                            x: l.dimensions.x || l.dimensions[0] || 0.1, 
                            y: l.dimensions.y || l.dimensions[1] || 0.1, 
                            z: l.dimensions.z || l.dimensions[2] || 0.1 
                        };
                    } else {
                        dimensions = { x: 0.1, y: 0.1, z: 0.1 };
                    }
                } else {
                    dimensions = { x: 0.1, y: 0.1, z: 0.1 };
                }
                
                const visualType = (l.visualType || l.visual?.type || 'box') as GeometryType;
                
                newLinks[l.id] = {
                    id: l.id,
                    name: l.name || l.id,
                    inertial: {
                        mass: l.mass || 1.0,
                        inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.1, iyz: 0, izz: 0.1 }
                    },
                    visual: {
                        type: visualType,
                        dimensions: dimensions,
                        color: l.color || l.visual?.color || '#3b82f6',
                        origin: { xyz: {x:0,y:0,z:0}, rpy: {r:0,p:0,y:0} }
                    },
                    collision: {
                        type: visualType,
                        dimensions: dimensions,
                        color: '#ef4444',
                        origin: { xyz: {x:0,y:0,z:0}, rpy: {r:0,p:0,y:0} }
                    }
                };
            });
        }

        // Handle joints - support both array and object formats
        if (data.joints) {
            let jointsToProcess: any[] = [];
            if (Array.isArray(data.joints)) {
                jointsToProcess = data.joints;
            } else if (typeof data.joints === 'object') {
                // Convert object to array
                jointsToProcess = Object.values(data.joints);
            }
            
            jointsToProcess.forEach((j: any) => {
                if (!j || !j.id) {
                    console.warn('[AI Service] Skipping invalid joint:', j);
                    return;
                }
                
                newJoints[j.id] = {
                    id: j.id,
                    name: j.name || j.id,
                    type: (j.type || 'fixed') as JointType,
                    parentLinkId: j.parentLinkId || j.parent,
                    childLinkId: j.childLinkId || j.child,
                    origin: {
                        xyz: { 
                            x: j.originXYZ?.[0] || j.origin?.xyz?.x || j.origin?.xyz?.[0] || 0, 
                            y: j.originXYZ?.[1] || j.origin?.xyz?.y || j.origin?.xyz?.[1] || 0, 
                            z: j.originXYZ?.[2] || j.origin?.xyz?.z || j.origin?.xyz?.[2] || 0 
                        },
                        rpy: { 
                            r: j.originRPY?.[0] || j.origin?.rpy?.r || j.origin?.rpy?.[0] || 0, 
                            p: j.originRPY?.[1] || j.origin?.rpy?.p || j.origin?.rpy?.[1] || 0, 
                            y: j.originRPY?.[2] || j.origin?.rpy?.y || j.origin?.rpy?.[2] || 0 
                        }
                    },
                    axis: { 
                        x: j.axis?.[0] || j.axis?.x || 0, 
                        y: j.axis?.[1] || j.axis?.y || 0, 
                        z: j.axis?.[2] || j.axis?.z || 1 
                    },
                    limit: { 
                        lower: j.lowerLimit ?? j.limit?.lower ?? -1.57, 
                        upper: j.upperLimit ?? j.limit?.upper ?? 1.57, 
                        effort: j.effortLimit ?? j.limit?.effort ?? 100, 
                        velocity: j.velocityLimit ?? j.limit?.velocity ?? 10 
                    },
                    dynamics: { damping: 0, friction: 0 },
                    hardware: { 
                        armature: 0, 
                        motorType: j.motorType || 'None', 
                        motorId: '', 
                        motorDirection: 1 
                    }
                };
            });
        }
        
        console.log('[AI Service] Processed links:', Object.keys(newLinks).length);
        console.log('[AI Service] Processed joints:', Object.keys(newJoints).length);

        finalRobotState = {
            name: data.name || "modified_robot",
            links: newLinks,
            joints: newJoints,
            rootLinkId: data.rootLinkId
        };
    }

    // Determine action type based on data presence
    let actionType: 'modification' | 'generation' | 'advice' = result.actionType || 'advice';
    if (finalRobotState && (finalRobotState.links || finalRobotState.joints)) {
        // If we have robot data, it's either generation or modification
        actionType = result.actionType || (Object.keys(currentRobot.links).length === 0 ? 'generation' : 'modification');
    }
    
    // Use extracted explanation or generate one if missing
    let explanation = explanationText;
    if (!explanation) {
        if (finalRobotState) {
            explanation = `已${actionType === 'generation' ? '生成' : '修改'}机器人结构。包含 ${Object.keys(finalRobotState.links || {}).length} 个链接和 ${Object.keys(finalRobotState.joints || {}).length} 个关节。`;
        } else {
            // For advice responses, try to provide more context
            if (result.suggestions && Array.isArray(result.suggestions)) {
                explanation = 'AI 已处理您的请求，但未返回机器人数据。';
            } else {
                explanation = 'AI 已处理您的请求，但未返回机器人数据。';
            }
        }
    }
    
    console.log("[AI Service] Final response:", {
        explanation: explanation?.substring(0, 50) + "...",
        actionType,
        hasRobotData: !!finalRobotState
    });

    return {
        explanation: explanation,
        actionType: actionType,
        robotData: finalRobotState
    };

  } catch (e: any) {
    console.error("OpenAI API call failed", e);
    console.error("Error details:", {
      message: e?.message,
      status: e?.status,
      code: e?.code,
      response: e?.response
    });
    
    // 返回一个包含错误信息的响应，而不是 null
    return {
      explanation: `API 调用失败: ${e?.message || '未知错误'}${e?.status ? ` (状态码: ${e.status})` : ''}`,
      actionType: 'advice' as const
    };
  }
};

// Helper function to get simplified robot context
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
  };
};

export const runRobotInspection = async (robot: RobotState, selectedItems?: Record<string, string[]>, lang: 'en' | 'zh' = 'en'): Promise<InspectionReport | null> => {
  if (!process.env.API_KEY) {
    console.error("API Key missing");
    return {
      summary: "API Key is missing. Please configure the environment.",
      issues: [{ type: 'error', title: "Configuration Error", description: "API Key is missing. Please configure the environment." }]
    };
  }

  const openai = new OpenAI({ 
    apiKey: process.env.API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    dangerouslyAllowBrowser: true
  });

  const modelName = process.env.OPENAI_MODEL || 'bce/deepseek-v3.2';
  const contextRobot = getContextRobot(robot);

  // 构建评估标准说明（只包含选中的检查项）
  const criteriaDescription = INSPECTION_CRITERIA.map(category => {
    const selectedItemIds = selectedItems?.[category.id] || [];
    if (selectedItemIds.length === 0) return null;
    
    const categoryName = lang === 'zh' ? category.nameZh : category.name;
    const itemsDesc = category.items
      .filter(item => selectedItemIds.includes(item.id))
      .map(item => {
        const itemName = lang === 'zh' ? item.nameZh : item.name;
        const itemDesc = lang === 'zh' ? item.descriptionZh : item.description;
        return `    - ${itemName} (${item.id}): ${itemDesc}`;
      }).join('\n');
    
    if (itemsDesc) {
      return `  ${category.id} (${categoryName}, weight: ${category.weight * 100}%):\n${itemsDesc}`;
    }
    return null;
  }).filter(Boolean).join('\n\n');

  const languageInstruction = lang === 'zh' 
    ? '请使用中文生成所有报告内容，包括总结、问题标题和描述。'
    : 'Please generate all report content in English, including summary, issue titles and descriptions.';

  const systemPrompt = lang === 'zh' ? `
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
  ` : `
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
  `;

  try {
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Inspect this robot structure:\n${JSON.stringify(contextRobot)}` }
      ],
      response_format: { 
        type: "json_object"
      },
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        summary: "Failed to get inspection response.",
        issues: [{ type: 'error', title: "Inspection Error", description: "The AI service returned empty content." }]
      };
    }

    console.log("[Inspection] Raw response content:", content.substring(0, 200) + "...");

    let result;
    try {
      result = JSON.parse(content);
    } catch (parseError: any) {
      console.error("Failed to parse inspection JSON", parseError);
      console.error("Content that failed to parse:", content);
      
      // Fallback: try to extract JSON from markdown code blocks
      const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) {
        try {
          result = JSON.parse(jsonBlockMatch[1]);
          console.log("[Inspection] Successfully parsed JSON from code block");
        } catch (e) {
          console.error("Failed to parse JSON from code block", e);
        }
      }
      
      // Fallback: try to extract JSON by finding first { and last }
      if (!result) {
        const firstOpen = content.indexOf('{');
        const lastClose = content.lastIndexOf('}');
        if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
          try {
            result = JSON.parse(content.substring(firstOpen, lastClose + 1));
            console.log("[Inspection] Successfully parsed JSON from extracted substring");
          } catch (e) {
            console.error("Failed to parse JSON from extracted substring", e);
          }
        }
      }
      
      if (!result) {
        return {
          summary: "Failed to parse inspection results.",
          issues: [{ type: 'error', title: "Parse Error", description: `Failed to parse JSON: ${parseError?.message || 'unknown error'}\n\n原始响应: ${content.substring(0, 500)}` }]
        };
      }
    }

    // 处理返回的 issues，确保包含评分信息
    const issues = (result.issues || []).map((issue: any) => {
      // 如果没有 score，根据 type 计算
      if (issue.score === undefined) {
        issue.score = calculateItemScore(issue.type, true);
      }
      // 确保 category 和 itemId 存在
      if (!issue.category) {
        // 尝试从 title 推断 category（简单映射）
        if (issue.title.toLowerCase().includes('mass') || issue.title.toLowerCase().includes('inertia')) {
          issue.category = 'physical';
        } else if (issue.title.toLowerCase().includes('axis') || issue.title.toLowerCase().includes('joint')) {
          issue.category = 'kinematics';
        } else if (issue.title.toLowerCase().includes('name')) {
          issue.category = 'naming';
        } else if (issue.title.toLowerCase().includes('symmetry') || issue.title.toLowerCase().includes('left') || issue.title.toLowerCase().includes('right')) {
          issue.category = 'symmetry';
        } else if (issue.title.toLowerCase().includes('motor') || issue.title.toLowerCase().includes('hardware')) {
          issue.category = 'hardware';
        }
      }
      return issue;
    });

    // 为所有选中的检查项生成完整的列表，包括通过的项
    const allIssues: typeof issues = [...issues];
    const reportedItems = new Set<string>(); // categoryId:itemId 格式
    
    // 记录已报告的项
    issues.forEach((issue: any) => {
      if (issue.category && issue.itemId) {
        reportedItems.add(`${issue.category}:${issue.itemId}`);
      }
    });
    
    // 为所有选中的但未报告的项创建通过的项
    if (selectedItems) {
      Object.keys(selectedItems).forEach(categoryId => {
        const selectedItemIds = selectedItems[categoryId] || [];
        selectedItemIds.forEach(itemId => {
          const key = `${categoryId}:${itemId}`;
          if (!reportedItems.has(key)) {
            const item = getInspectionItem(categoryId, itemId);
            if (item) {
              const itemName = lang === 'zh' ? item.nameZh : item.name;
              const itemDesc = lang === 'zh' ? item.descriptionZh : item.description;
              allIssues.push({
                type: 'pass',
                title: lang === 'zh' ? `${itemName} - 通过` : `${itemName} - Passed`,
                description: lang === 'zh' 
                  ? `该检查项已通过：${itemDesc}` 
                  : `This check item passed: ${itemDesc}`,
                category: categoryId,
                itemId: itemId,
                score: 10
              });
            }
          }
        });
      });
    }

    // 计算章节得分
    const categoryScores: Record<string, number[]> = {};
    INSPECTION_CRITERIA.forEach(category => {
      categoryScores[category.id] = [];
    });

    // 收集每个章节的得分
    allIssues.forEach((issue: any) => {
      if (issue.category && issue.score !== undefined) {
        if (!categoryScores[issue.category]) {
          categoryScores[issue.category] = [];
        }
        categoryScores[issue.category].push(issue.score);
      }
    });

    // 计算每个章节的平均分
    const categoryScoreMap: Record<string, number> = {};
    Object.keys(categoryScores).forEach(categoryId => {
      const scores = categoryScores[categoryId];
      if (scores.length > 0) {
        categoryScoreMap[categoryId] = calculateCategoryScore(scores);
      } else {
        // 如果该章节没有检查项，默认给满分
        categoryScoreMap[categoryId] = 10;
      }
    });

    // 收集所有检查项的得分用于累加计算总分
    const allItemScores: number[] = [];
    allIssues.forEach((issue: any) => {
      if (issue.score !== undefined) {
        allItemScores.push(issue.score);
      }
    });

    // 计算总分（累加所有检查项得分）
    const overallScore = calculateOverallScore(categoryScoreMap, allItemScores);
    
    // 计算满分：所有检查项的数量 * 10（每个检查项满分10分）
    const maxScore = allItemScores.length > 0 ? allItemScores.length * 10 : 100;

    return {
      summary: result.summary || "Inspection completed.",
      issues: allIssues,
      overallScore: Math.round(overallScore * 10) / 10, // 保留一位小数
      categoryScores: categoryScoreMap,
      maxScore: maxScore
    } as InspectionReport;

  } catch (e: any) {
    console.error("Inspection failed", e);
    return {
      summary: "Failed to complete inspection due to an AI error.",
      issues: [{ type: 'error', title: "Inspection Error", description: `The AI service could not process the request: ${e?.message || 'unknown error'}` }]
    };
  }
};
