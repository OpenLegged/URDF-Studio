# URDF 机器人检查标准

本文档详细说明了 URDF 机器人检查系统的评估标准和评分方法。

## 评分体系

### 评分范围
- 每个检查项的满分：**10分**
- 总分计算方式：**所有检查项得分的累加**

### 评分标准
根据检查结果的问题类型，分配不同的分数：

- **错误 (Error)**: 0-3分
- **警告 (Warning)**: 4-6分
- **建议 (Suggestion)**: 7-9分
- **通过 (Pass)**: 10分

### 进度条颜色标准
基于10分制归一化后的分数：
- **6分以下**: 红色
- **6-9分**: 黄色
- **9分以上**: 绿色

---

## 检查章节

### 1. 物理合理性 (Physical Plausibility)
**权重**: 30%  
**章节ID**: `physical`

#### 1.1 质量验证 (Mass Validation)
- **项目ID**: `mass_check`
- **描述**: 检查所有动态链接的质量是否大于0
- **满分**: 10分

#### 1.2 惯性矩阵对角元素 (Inertia Diagonal Elements)
- **项目ID**: `inertia_diagonal`
- **描述**: 检查惯性矩阵对角元素 (ixx, iyy, izz) 是否都大于0
- **满分**: 10分

#### 1.3 惯性矩阵三角不等式 (Inertia Triangle Inequality)
- **项目ID**: `inertia_triangle`
- **描述**: 检查三角不等式：ixx + iyy > izz, ixx + izz > iyy, iyy + izz > ixx
- **满分**: 10分

#### 1.4 质心位置 (Center of Mass)
- **项目ID**: `center_of_mass`
- **描述**: 检查质心位置是否相对于几何形状合理
- **满分**: 10分

---

### 2. 运动学 (Kinematics)
**权重**: 30%  
**章节ID**: `kinematics`

#### 2.1 零轴向量 (Zero Axis Vector)
- **项目ID**: `axis_zero`
- **描述**: 检查旋转/连续/滑动关节的轴向量是否为[0,0,0]
- **满分**: 10分

#### 2.2 孤立链接 (Orphan Links)
- **项目ID**: `orphan_links`
- **描述**: 检查未通过关节连接的浮动链接（根链接除外）
- **满分**: 10分

#### 2.3 关节连通性 (Joint Connectivity)
- **项目ID**: `joint_connectivity`
- **描述**: 验证所有关节是否正确连接父链接和子链接
- **满分**: 10分

#### 2.4 关节限位 (Joint Limits)
- **项目ID**: `joint_limits`
- **描述**: 检查关节限位是否合理（下限 < 上限，范围合理）
- **满分**: 10分

---

### 3. 命名规范 (Naming Conventions)
**权重**: 15%  
**章节ID**: `naming`

#### 3.1 重复名称 (Duplicate Names)
- **项目ID**: `duplicate_names`
- **描述**: 检查关节或链接中是否存在重复的用户友好名称
- **满分**: 10分

#### 3.2 命名一致性 (Naming Consistency)
- **项目ID**: `naming_consistency`
- **描述**: 检查命名是否遵循一致的约定（snake_case vs camelCase）
- **满分**: 10分

#### 3.3 描述性名称 (Descriptive Names)
- **项目ID**: `descriptive_names`
- **描述**: 检查名称是否具有描述性和意义
- **满分**: 10分

---

### 4. 对称性 (Symmetry)
**权重**: 15%  
**章节ID**: `symmetry`

#### 4.1 左右配对 (Left/Right Pairs)
- **项目ID**: `left_right_pairs`
- **描述**: 识别并检查左右配对（例如：L_leg vs R_leg）
- **满分**: 10分

#### 4.2 对称属性 (Symmetric Properties)
- **项目ID**: `symmetry_properties`
- **描述**: 检查对称配对是否具有相似的物理属性（质量、惯性、尺寸）
- **满分**: 10分

---

### 5. 硬件配置 (Hardware Configuration)
**权重**: 10%  
**章节ID**: `hardware`

#### 5.1 电机选择 (Motor Selection)
- **项目ID**: `motor_selection`
- **描述**: 检查电机类型是否适合关节要求
- **满分**: 10分

#### 5.2 电机限位 (Motor Limits)
- **项目ID**: `motor_limits`
- **描述**: 验证电机力矩和速度限位是否匹配关节要求
- **满分**: 10分

#### 5.3 电枢配置 (Armature Configuration)
- **项目ID**: `armature_config`
- **描述**: 检查电枢值是否合理
- **满分**: 10分

---

## 检查流程

1. **选择检查项**: 用户可以选择要检查的章节和具体项目
2. **执行检查**: AI 检查器逐项分析机器人结构
3. **生成报告**: 检查完成后生成详细报告，包含：
   - 总体得分
   - 各章节得分
   - 每个检查项的详细问题和建议
4. **导出报告**: 支持导出 PDF 格式的检查报告

---

## 注意事项

- 所有检查项都是可选的，用户可以根据需要选择要检查的项目
- 总分是所有选中检查项得分的累加
- 如果某个章节没有选中任何检查项，该章节不会影响总分
- 检查报告会根据当前语言设置生成对应语言的内容

---

*最后更新: 2025年1月4日

