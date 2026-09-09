# URDF-Studio 开源/闭源双版本策略

> 最后更新：2026-09-09 | 状态：方案设计（未实施）

## Context

URDF-Studio 当前是一个纯前端 SPA（React 19 + Vite 6 + Zustand + Three.js），无后端服务。需要在保持开源版本免费完整的同时，创建一个闭源商业版本，增加后端模型广场、账号登录等付费功能。核心挑战是**如何让两个版本的主体功能保持同步，同时清晰隔离闭源代码**。

---

## 方案对比与推荐

推荐 **方案 B：Monorepo + 共享核心包 + 两个应用壳**。

| 维度 | 方案A (Feature Flag) | **方案B (共享核心包)** | 方案C (Fork同步) | 方案D (插件架构) |
|------|---------------------|----------------------|-----------------|-----------------|
| 同步难度 | 低 | **低** | 高（merge冲突） | 低 |
| 代码泄露风险 | **高**（同一仓库） | **低**（物理隔离） | 低 | 低 |
| 初始改造成本 | 低 | **中** | 最低 | 高 |
| 长期可维护性 | 中 | **高** | 低（drift风险） | 高 |
| 扩展性 | 中 | **高** | 低 | 最高 |
| CI/CD 复杂度 | 高 | **中** | 低 | 高 |

**方案B 是最佳平衡点**：物理隔离防止代码泄露，共享核心包保证同步，monorepo 管理降低维护成本。

---

## 仓库结构设计

```
urdf-studio/                          # 私有 Monorepo (GitHub Private)
├── packages/
│   ├── core/                         # 开源核心（同步发布到公开仓库）
│   │   ├── src/
│   │   │   ├── app/                  # 现有 App.tsx, AppLayout.tsx, Header.tsx
│   │   │   ├── core/                 # 现有 parsers/, robot/, loaders/
│   │   │   ├── features/             # 所有共享功能模块
│   │   │   │   ├── urdf-gallery/     # 模型广场（开源版：本地数据）
│   │   │   │   ├── ai-assistant/
│   │   │   │   ├── property-editor/
│   │   │   │   ├── visualizer/
│   │   │   │   ├── code-editor/
│   │   │   │   ├── file-io/
│   │   │   │   ├── robot-tree/
│   │   │   │   ├── assembly/
│   │   │   │   └── hardware-config/
│   │   │   ├── shared/               # 现有共享组件、hooks、i18n
│   │   │   ├── store/                # Zustand stores
│   │   │   └── types/                # TypeScript 类型
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── web/                          # 开源版应用壳
│   │   ├── src/
│   │   │   ├── main.tsx              # 入口，注入开源版配置
│   │   │   └── edition.ts            # edition = 'community'
│   │   ├── public/                   # 静态资源（含本地模型库）
│   │   │   └── library/urdf/
│   │   ├── package.json              # 依赖 @urdf-studio/core
│   │   └── vite.config.ts
│   │
│   └── pro/                          # 闭源版应用壳
│       ├── src/
│       │   ├── main.tsx              # 入口，注入闭源版配置 + Provider
│       │   ├── edition.ts            # edition = 'pro'
│       │   ├── features/             # 闭源专属功能
│       │   │   ├── auth/             # 账号登录系统
│       │   │   │   ├── components/   # LoginModal, UserMenu, etc.
│       │   │   │   ├── services/     # authService.ts
│       │   │   │   └── store/        # authStore.ts
│       │   │   ├── cloud-gallery/    # 后端模型广场（覆盖开源版）
│       │   │   │   ├── components/   # CloudGallery.tsx
│       │   │   │   └── services/     # galleryAPI.ts
│       │   │   ├── cloud-save/       # 云端项目保存
│       │   │   └── analytics/        # 用户分析
│       │   └── providers/            # ProEditionProvider
│       ├── package.json              # 依赖 @urdf-studio/core
│       └── vite.config.ts
│
├── apps/
│   └── server/                       # 闭源后端服务
│       ├── src/
│       │   ├── routes/
│       │   │   ├── auth.ts           # 登录/注册 API
│       │   │   ├── gallery.ts        # 模型广场 API
│       │   │   ├── models.ts         # 模型 CRUD
│       │   │   └── users.ts          # 用户管理
│       │   ├── middleware/
│       │   │   └── auth.ts           # JWT 认证中间件
│       │   ├── database/
│       │   │   └── schema.ts         # 数据库模型
│       │   └── index.ts
│       └── package.json
│
├── pnpm-workspace.yaml
├── turbo.json                        # Turborepo 构建编排
└── package.json
```

---

## 核心机制：Edition Context（版本上下文）

在 `core` 包中定义一个 **EditionContext**，作为开源版和闭源版的桥梁：

```
core/src/shared/edition/
├── EditionContext.ts          # React Context 定义
├── types.ts                   # EditionConfig 类型
└── useEdition.ts              # Hook: useEdition()
```

### EditionConfig 类型设计思路

```typescript
interface EditionConfig {
  edition: 'community' | 'pro';

  // 功能覆盖点（Slots）
  slots: {
    // 模型广场：开源版用本地组件，闭源版注入云端组件
    GalleryComponent?: React.ComponentType<GalleryProps>;
    // Header 右侧区域：闭源版注入用户头像/登录按钮
    HeaderRight?: React.ComponentType;
    // 设置面板扩展
    SettingsExtra?: React.ComponentType;
  };

  // 服务覆盖
  services: {
    // 模型获取：开源版用本地数据，闭源版用 API
    fetchModels?: () => Promise<RobotModel[]>;
    // 模型下载
    downloadModel?: (modelId: string) => Promise<File[]>;
  };

  // 功能开关
  features: {
    cloudSave: boolean;
    userAccounts: boolean;
    modelUpload: boolean;
    analytics: boolean;
  };
}
```

### 工作流程

1. **开源版 `web/src/main.tsx`**：
   - 提供默认 EditionConfig：`edition='community'`，所有 slots 为空，features 全部 false
   - Gallery 使用 core 内置的 URDFGallery（本地数据）

2. **闭源版 `pro/src/main.tsx`**：
   - 提供增强 EditionConfig：`edition='pro'`
   - 注入 `CloudGallery` 到 `slots.GalleryComponent`
   - 注入 `UserMenu` 到 `slots.HeaderRight`
   - 设置 `features.userAccounts = true` 等
   - 包裹 `AuthProvider`

3. **Core 组件内部**：
   - `URDFGallery.tsx` 检查 `slots.GalleryComponent`，如果有就渲染闭源组件，否则渲染自身
   - `Header.tsx` 检查 `slots.HeaderRight`，如果有就渲染用户菜单

---

## 模型广场迁移方案

### 开源版（保持现状 + 小幅优化）

当前 `URDFGallery.tsx` 的硬编码数据保持不变，继续从 `/public/library/urdf/` 加载。

唯一改动：将模型数据抽取到独立文件 `core/src/features/urdf-gallery/data/models.ts`，便于维护。

### 闭源版（后端 API）

```
闭源版 CloudGallery -> galleryAPI.ts -> 后端 /api/gallery/models
                                          |
                                      数据库 (PostgreSQL)
                                          |
                                      对象存储 (S3/MinIO) -> URDF 文件
```

- 后端提供 RESTful API：`GET /api/gallery/models`、`GET /api/gallery/models/:id/download`
- 支持分页、搜索、分类筛选、排序
- 用户可上传自己的模型（需登录）
- 复用 `core` 的 `RobotModel` 类型定义

---

## 账号登录系统（仅闭源版）

```
pro/src/features/auth/
├── components/
│   ├── LoginModal.tsx         # 登录/注册弹窗
│   ├── UserMenu.tsx           # Header 用户菜单（注入到 slots.HeaderRight）
│   └── ProtectedRoute.tsx     # 需要登录的功能守卫
├── services/
│   └── authService.ts         # JWT token 管理、API 调用
├── store/
│   └── authStore.ts           # Zustand store: user, token, isLoggedIn
└── providers/
    └── AuthProvider.tsx        # 初始化认证状态、token 刷新
```

- 使用 JWT（access token + refresh token）
- 后端: `/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`
- 支持第三方登录（GitHub OAuth 等，可选）

---

## 同步工作流

### Git 工作流

```
私有 Monorepo (urdf-studio)
    |
    ├── packages/core/   ---- 自动同步 ---->  公开仓库 (URDF-Studio)
    ├── packages/web/    ---- 自动同步 ---->  公开仓库 (URDF-Studio)
    └── packages/pro/    ---- 不同步（私有）
    └── apps/server/     ---- 不同步（私有）
```

### 推荐：GitHub Actions 自动同步

- 当 `packages/core/` 或 `packages/web/` 有变更 push 到 main 时
- CI 自动将这两个目录的内容同步到公开仓库
- 使用 `git-subtree` 或专用同步脚本

### 社区贡献处理

1. 社区向公开仓库提交 PR
2. 维护者在公开仓库 review & merge
3. CI 自动同步回私有 monorepo 的 `packages/core/`
4. 闭源版自动获得更新

---

## CI/CD 流水线

```
私有 Monorepo CI (GitHub Actions)
|
├── On push to packages/core or packages/web:
│   ├── Build & Test core
│   ├── Build web (开源版)
│   ├── Deploy 开源版到 GitHub Pages / Vercel
│   └── 同步到公开仓库
│
├── On push to packages/pro or apps/server:
│   ├── Build & Test pro
│   ├── Build server
│   └── Deploy 闭源版到私有服务器
│
└── Nightly:
    └── 完整集成测试（core + web + pro + server）
```

---

## 迁移步骤（从当前项目到双版本架构）

### 阶段 1：基础设施搭建（1-2 周）
1. 创建私有 monorepo，配置 pnpm workspaces + Turborepo
2. 将当前代码移入 `packages/core/`
3. 创建 `packages/web/` 应用壳，确保能正常构建和运行（功能与当前完全一致）
4. 设置公开仓库同步机制
5. 添加 EditionContext 到 core

### 阶段 2：闭源壳搭建（1 周）
1. 创建 `packages/pro/` 应用壳
2. 实现基础 ProEditionProvider
3. 确保 pro 版能正常加载 core 功能

### 阶段 3：后端服务（2-3 周）
1. 搭建 `apps/server/`（推荐 Hono/Express + PostgreSQL + Drizzle ORM）
2. 实现账号系统 API
3. 实现模型广场 API
4. 数据迁移：将硬编码模型数据导入数据库

### 阶段 4：闭源功能集成（2 周）
1. 实现 CloudGallery 组件，注入到 pro 版
2. 实现登录系统 UI，注入到 pro 版
3. 实现 Header 用户菜单
4. 端到端测试

### 阶段 5：发布（1 周）
1. 开源版继续发布到现有渠道
2. 闭源版部署到私有服务器
3. 文档更新

---

## 关键设计原则

1. **Core 不依赖 Pro**：core 包绝不能 import pro 的任何代码，依赖方向是 pro -> core
2. **Slot 而非 If-Else**：不在 core 中写 `if (edition === 'pro')` 判断，而是通过 slot 注入
3. **类型共享**：`RobotModel` 等类型定义在 core，pro 复用
4. **开源版零降级**：迁移后开源版功能与当前完全一致，不减少任何功能
5. **渐进式迁移**：先搭架子确保能跑，再逐步迁移功能

---

## 涉及的关键文件变动

现有文件（将移入 `packages/core/`）：
- `src/app/App.tsx` — 主应用，需添加 EditionProvider 包裹
- `src/app/components/Header.tsx` — 需添加 HeaderRight slot
- `src/features/urdf-gallery/components/URDFGallery.tsx` — 需添加 GalleryComponent slot 判断
- `src/store/uiStore.ts` — 可能需要扩展 edition 相关状态
- `src/shared/i18n/locales/en.ts`, `zh.ts` — 闭源版需扩展翻译
- `vite.config.ts` — 需要适配 monorepo 路径

新增文件：
- `packages/core/src/shared/edition/EditionContext.ts` — 版本上下文
- `packages/web/src/main.tsx` — 开源版入口
- `packages/pro/src/main.tsx` — 闭源版入口
- `packages/pro/src/features/auth/` — 认证系统
- `packages/pro/src/features/cloud-gallery/` — 云端模型广场
- `apps/server/` — 后端服务

---

## 验证标准

1. `packages/web/` 构建后功能与当前 URDF-Studio 完全一致
2. `packages/pro/` 构建后包含所有 core 功能 + 闭源功能
3. 修改 `packages/core/` 中任意功能，web 和 pro 同时生效
4. 公开仓库只包含 core + web 代码，不含 pro/server 代码
5. 社区 PR 能通过同步机制回流到 monorepo
