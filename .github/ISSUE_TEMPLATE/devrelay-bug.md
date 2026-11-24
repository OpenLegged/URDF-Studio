---
name: "DevRelay bug / 问题修复"
about: "Reproduce and fix a bounded bug / 复现并修复明确问题"
title: ''
labels: "bug"
assignees: ''
---

<!-- Maintainer triage / 维护者分诊:
One issue delivers one observable, reviewable result. Keep its required code, config, tests and docs together.
一个 Issue 对应一个可观察、可审查结果；实现该结果所需的代码、配置、测试和文档放在一起。
Split child issues only for independent value or acceptance criteria, not merely by file, layer or phase.
只有具备独立价值或验收标准才拆子项，不仅按文件、层或阶段拆分。
Priority is optional (default: the second configured priority, or the first if only one exists).
优先级可选，默认使用配置中的第二档；只有一档时使用该档。不填写 Depends on 表示无依赖。
Priorities / 优先级: ["priority:P0", "priority:P1", "priority:P2"]
Authorization / 执行授权: "auto:approved"
Blockers / 阻塞标签: ["blocked", "needs-input"]
Creating this issue does not authorize execution. Maintainers grant authorization separately.
创建 Issue 不表示允许自动执行；维护者确认范围与验收后另行授予授权。
Authorization never bypasses dependencies, blockers or acceptance.
授权不绕过依赖、阻塞或验收；缺少外部输入时记录明确恢复条件。
Tracking parents must not receive execution authorization; authorize bounded children instead.
总体计划只跟踪交付，不加执行授权；给可独立验收的子任务授权。
Close only after full acceptance; a partial PR does not complete the issue.
完整验收通过后才关闭 Issue，部分 PR 不表示整个任务完成。
-->

## Problem and evidence / 问题与证据

<!-- Include affected behavior/artifact, version and reproducible evidence. -->

## Deliverable and exclusions / 交付与范围外内容

## Acceptance and commands / 验收与命令

- [ ] Observable deliverable and exact validation commands / 可核验交付及具体检查命令
- [ ] Relevant regression tests and documentation / 相关回归测试与文档

## Dependencies / 依赖

<!-- Optional declaration: none, or #12, #27; omission means no dependencies.
Dependencies must be closed and linked to merged PRs integrated into the configured base. / 声明可省略，省略表示无依赖；
依赖须已关闭，并有关联 PR 已合并到配置的目标分支。 -->
Depends on: none

## Resources, blockers and recovery / 资源、阻塞与恢复条件

<!-- State required data/decisions and recovery conditions; never include credentials. -->
