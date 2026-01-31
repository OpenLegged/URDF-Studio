# AI Prompt 系统概述

本文档记录了项目中用于驱动 AI 功能的提示词逻辑及参考标准。

## 1. 核心 Prompt 目录

- **[CLAUDE.md](./CLAUDE.md)**：项目架构与代码规范上下文，用于引导 AI 理解工程结构。
- **[visualizer.md](./visualizer.md)**：3D 可视化功能的详细描述，帮助 AI 生成符合 R3F 渲染逻辑的建议。
- **审阅标准 (Internal)**：
  - `src/features/ai-assistant/config/urdf_inspect_standard_zh.md`
  - `src/features/ai-assistant/config/urdf_inspect_standard_en.md`
  - *注：上述文件作为 AI 审阅功能的直接输入源，详细定义了评分逻辑和评估维度。*

## 2. 提示词编写原则

在与 AI 助手对话时，建议遵循：

1. **具体化**：指明具体的 Link 或 Joint 名称。
2. **结构化**：描述期望的父子连接关系。
3. **物理约束**：如果涉及电机更换，指明期望的力矩范围。
