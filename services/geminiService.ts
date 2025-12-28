
import OpenAI from "openai";
import { RobotState, GeometryType, JointType, MotorSpec } from '../types';

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
  You are an expert Robotics Engineer and URDF Architect.
  
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
