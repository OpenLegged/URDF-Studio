# Workflow E2E fixtures

Deterministic, self-contained mini models for the import→edit→export→assembly
workflow suite (`scripts/test/e2e/test_workflow_suite.mjs`).

Unlike the large corpora under `test/unitree_ros`, `test/mujoco_menagerie-main`,
etc. (cloned by `npm run test:setup`, gitignored), these fixtures are committed
to the repository so quick-mode workflow runs need zero external setup.

| File | Format | Structure | Used for |
| --- | --- | --- | --- |
| `bar_segment.urdf` | URDF | base_link + tip_link, fixed joint, colored materials | bridge/assembly matrix (chain + self-loop), quick mode |
| `multi_link_chain.urdf` | URDF | 6 links, 5 revolute joints with limits | source-code editing (delete link, joint→fixed), quick mode |
| `mini.sdf` | SDF | 2 links, revolute joint | quick-mode SDF import + property editing |
| `mini_mjcf.xml` | MJCF | 2 bodies, hinge joint | quick-mode MJCF import + property editing |

Full-format journeys (USD/USDA, xacro, real robots) use the real corpora listed
in CLAUDE.md's 格式回归样本 section instead.
