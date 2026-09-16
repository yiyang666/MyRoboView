# ROS2 平台化文档

此目录仅存放文档，运行代码已按职责迁出。

- [功能评估与工作量](ASSESSMENT.md)
- [重构说明](REFACTOR.md)
- [分阶段路线](ROADMAP.md)
- [消息与接口约定](CONTRACTS.md)
- [验证记录](VALIDATION.md)
- [当前问题、优化建议与解决历史](OPTIMIZED.md)
- [2026-09-16 Vite 与安装体系代码评审](../review/code-review-20260916-214007.md)

当前环境为 x64 Ubuntu 24.04 / ROS2 Jazzy；目标硬件 Orin NX。安装、部署文档推迟到部署阶段。

2026-09-16 当前实现已迁移到 Vite 6，并形成按产品构建、统一安装与双产品集成验证链路。已验证范围见 [验证记录](VALIDATION.md)；尚未解决的干净检出构建和旧版增量安装残留问题，以 [OPTIMIZED](OPTIMIZED.md) 为准，不以本机测试通过替代发布验收。
