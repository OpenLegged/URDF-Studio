/**
 * URDF 机器人评估标准配置
 * 定义评估章节、检查条目和评分标准
 */

export interface InspectionItem {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  maxScore: number; // 满分，默认 10
}

export interface InspectionCategory {
  id: string;
  name: string;
  nameZh: string;
  weight: number; // 权重（0-1），用于计算总分
  items: InspectionItem[];
}

export const INSPECTION_CRITERIA: InspectionCategory[] = [
  {
    id: 'physical',
    name: 'Physical Plausibility',
    nameZh: '物理合理性',
    weight: 0.30,
    items: [
      {
        id: 'mass_check',
        name: 'Mass Validation',
        nameZh: '质量验证',
        description: 'Check that all dynamic links have mass > 0',
        descriptionZh: '检查所有动态链接的质量是否大于0',
        maxScore: 10
      },
      {
        id: 'inertia_diagonal',
        name: 'Inertia Diagonal Elements',
        nameZh: '惯性矩阵对角元素',
        description: 'Check that diagonal elements (ixx, iyy, izz) are all > 0',
        descriptionZh: '检查惯性矩阵对角元素 (ixx, iyy, izz) 是否都大于0',
        maxScore: 10
      },
      {
        id: 'inertia_triangle',
        name: 'Inertia Triangle Inequality',
        nameZh: '惯性矩阵三角不等式',
        description: 'Check triangle inequality: ixx + iyy > izz, ixx + izz > iyy, iyy + izz > ixx',
        descriptionZh: '检查三角不等式：ixx + iyy > izz, ixx + izz > iyy, iyy + izz > ixx',
        maxScore: 10
      },
      {
        id: 'center_of_mass',
        name: 'Center of Mass',
        nameZh: '质心位置',
        description: 'Check if center of mass is reasonably positioned relative to geometry',
        descriptionZh: '检查质心位置是否相对于几何形状合理',
        maxScore: 10
      }
    ]
  },
  {
    id: 'kinematics',
    name: 'Kinematics',
    nameZh: '运动学',
    weight: 0.30,
    items: [
      {
        id: 'axis_zero',
        name: 'Zero Axis Vector',
        nameZh: '零轴向量',
        description: 'Check for revolute/continuous/prismatic joints with axis vector [0,0,0]',
        descriptionZh: '检查旋转/连续/滑动关节的轴向量是否为[0,0,0]',
        maxScore: 10
      },
      {
        id: 'orphan_links',
        name: 'Orphan Links',
        nameZh: '孤立链接',
        description: 'Check for floating links not connected via joints (except root)',
        descriptionZh: '检查未通过关节连接的浮动链接（根链接除外）',
        maxScore: 10
      },
      {
        id: 'joint_connectivity',
        name: 'Joint Connectivity',
        nameZh: '关节连通性',
        description: 'Verify all joints properly connect parent and child links',
        descriptionZh: '验证所有关节是否正确连接父链接和子链接',
        maxScore: 10
      },
      {
        id: 'joint_limits',
        name: 'Joint Limits',
        nameZh: '关节限位',
        description: 'Check if joint limits are reasonable (lower < upper, reasonable ranges)',
        descriptionZh: '检查关节限位是否合理（下限 < 上限，范围合理）',
        maxScore: 10
      }
    ]
  },
  {
    id: 'naming',
    name: 'Naming Conventions',
    nameZh: '命名规范',
    weight: 0.15,
    items: [
      {
        id: 'duplicate_names',
        name: 'Duplicate Names',
        nameZh: '重复名称',
        description: 'Check for duplicate user-friendly names in joints or links',
        descriptionZh: '检查关节或链接中是否存在重复的用户友好名称',
        maxScore: 10
      },
      {
        id: 'naming_consistency',
        name: 'Naming Consistency',
        nameZh: '命名一致性',
        description: 'Check if naming follows consistent convention (snake_case vs camelCase)',
        descriptionZh: '检查命名是否遵循一致的约定（snake_case vs camelCase）',
        maxScore: 10
      },
      {
        id: 'descriptive_names',
        name: 'Descriptive Names',
        nameZh: '描述性名称',
        description: 'Check if names are descriptive and meaningful',
        descriptionZh: '检查名称是否具有描述性和意义',
        maxScore: 10
      }
    ]
  },
  {
    id: 'symmetry',
    name: 'Symmetry',
    nameZh: '对称性',
    weight: 0.15,
    items: [
      {
        id: 'left_right_pairs',
        name: 'Left/Right Pairs',
        nameZh: '左右配对',
        description: 'Identify and check Left/Right pairs (e.g., L_leg vs R_leg)',
        descriptionZh: '识别并检查左右配对（例如：L_leg vs R_leg）',
        maxScore: 10
      },
      {
        id: 'symmetry_properties',
        name: 'Symmetric Properties',
        nameZh: '对称属性',
        description: 'Check if symmetric pairs have similar physical properties (mass, inertia, dimensions)',
        descriptionZh: '检查对称配对是否具有相似的物理属性（质量、惯性、尺寸）',
        maxScore: 10
      }
    ]
  },
  {
    id: 'hardware',
    name: 'Hardware Configuration',
    nameZh: '硬件配置',
    weight: 0.10,
    items: [
      {
        id: 'motor_selection',
        name: 'Motor Selection',
        nameZh: '电机选择',
        description: 'Check if motor types are appropriate for joint requirements',
        descriptionZh: '检查电机类型是否适合关节要求',
        maxScore: 10
      },
      {
        id: 'motor_limits',
        name: 'Motor Limits',
        nameZh: '电机限位',
        description: 'Verify motor effort and velocity limits match joint requirements',
        descriptionZh: '验证电机力矩和速度限位是否匹配关节要求',
        maxScore: 10
      },
      {
        id: 'armature_config',
        name: 'Armature Configuration',
        nameZh: '电枢配置',
        description: 'Check if armature values are reasonable',
        descriptionZh: '检查电枢值是否合理',
        maxScore: 10
      }
    ]
  }
];

/**
 * 根据检查结果类型计算得分
 * @param type 问题类型
 * @param hasIssue 是否存在问题
 * @returns 得分 (0-10)
 */
export function calculateItemScore(type: 'error' | 'warning' | 'suggestion' | 'pass', hasIssue: boolean): number {
  if (!hasIssue) return 10; // 通过检查
  
  switch (type) {
    case 'error':
      return Math.floor(Math.random() * 4); // 0-3 分
    case 'warning':
      return 4 + Math.floor(Math.random() * 3); // 4-6 分
    case 'suggestion':
      return 7 + Math.floor(Math.random() * 3); // 7-9 分
    case 'pass':
      return 10;
    default:
      return 5;
  }
}

/**
 * 计算章节得分（该章节下所有条目得分的平均值）
 */
export function calculateCategoryScore(itemScores: number[]): number {
  if (itemScores.length === 0) return 0;
  const sum = itemScores.reduce((a, b) => a + b, 0);
  return sum / itemScores.length;
}

/**
 * 计算总分（各项得分的累加）
 * @param categoryScores 各章节得分
 * @param itemScores 所有检查项的得分数组
 */
export function calculateOverallScore(categoryScores: Record<string, number>, itemScores?: number[]): number {
  // 如果提供了所有检查项的得分，则累加所有得分
  if (itemScores && itemScores.length > 0) {
    return itemScores.reduce((sum, score) => sum + score, 0);
  }
  
  // 否则使用旧方法（向后兼容）
  let total = 0;
  let totalWeight = 0;
  
  INSPECTION_CRITERIA.forEach(category => {
    const score = categoryScores[category.id] || 0;
    total += score * category.weight;
    totalWeight += category.weight;
  });
  
  return totalWeight > 0 ? total / totalWeight : 0;
}

/**
 * 根据 ID 获取检查条目
 */
export function getInspectionItem(categoryId: string, itemId: string): InspectionItem | undefined {
  const category = INSPECTION_CRITERIA.find(c => c.id === categoryId);
  return category?.items.find(item => item.id === itemId);
}

/**
 * 根据 ID 获取章节
 */
export function getInspectionCategory(categoryId: string): InspectionCategory | undefined {
  return INSPECTION_CRITERIA.find(c => c.id === categoryId);
}

