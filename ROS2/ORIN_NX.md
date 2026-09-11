# Jetson Orin NX 部署计划

## 确定的目标与待核对环境

用户指定 **Orin NX + ROS2 C++**。本计划优先选择 JetPack 6.x / Ubuntu 22.04 / ROS2 Humble 原生部署。NVIDIA 的 JetPack 6.2.2 页面说明其 Jetson Linux 36.5 基于 Ubuntu22.04，支持 Orin；ROS2 Humble 官方提供 Ubuntu22.04 amd64/arm64 包。

来源（2026-09-11 核对）：[NVIDIA JetPack 6.2.2](https://developer.nvidia.com/embedded/jetpack-sdk-622)、[ROS2 Humble 安装](https://docs.ros.org/en/humble/Installation/Ubuntu-Install-Debs.html)。这是选择现有稳定组合，不是要求立即刷机或追随最新 JetPack。

本机为 Ubuntu24.04/Jazzy/x86_64。实际 Orin 的 JetPack、L4T、内存、磁盘、SSH 地址和 ROS 版本尚未获取，本轮没有连接设备、安装板端服务或宣称完成部署。若板端已有其他受支持环境，先评估适配，不能覆盖现有机器人环境。

## 1. 只读检查板端

连接设备后记录：

```bash
uname -a
uname -m
cat /etc/os-release
cat /etc/nv_tegra_release
ls /opt/ros
free -h
df -h
```

确认 arm64、Ubuntu22.04、足够的构建空间，以及 app 的 ROS/RMW/domain。不要把 x86_64 的 build/install 拷贝到 Orin 运行。

## 2. 在 Orin 本机编译

先按 ROS 官方指引安装 Humble 与配置 apt 源。其余依赖：

```bash
sudo apt install build-essential cmake python3-colcon-common-extensions libboost-system-dev libjsoncpp-dev ros-humble-ros-base ros-humble-sensor-msgs ros-humble-nav-msgs ros-humble-rosidl-default-generators ros-humble-rosidl-typesupport-introspection-cpp

git clone --branch develop https://github.com/yiyang666/MyRoboView.git
cd MyRoboView
export ROS_DISTRO=humble
# 限制并行度可降低板端内存峰值
export CMAKE_BUILD_PARALLEL_LEVEL=2
./scripts/build.sh
./scripts/test.sh
./scripts/run_demo.sh
```

私有仓库使用已有 GitHub 授权，不把访问令牌写进部署文件。首次板端自测不启动真实 app 控制能力。

## 3. 开发机访问

将 `<user>` 和 `<orin-ip>` 替换为设备信息，在开发机执行：

```bash
ssh -N -L 18080:127.0.0.1:8080 <user>@<orin-ip>
```

浏览器访问 `http://127.0.0.1:18080` 可检查后端；主 React 界面建议在开发机启动，先在开发机设置 `ssh -N -L 8080:127.0.0.1:8080 <user>@<orin-ip>`，再 `cd my-app && HOST=127.0.0.1 BROWSER=none npm start`，访问端口 3000。两种转发方式择一，本机 8080 必须空闲。桥接只绑定 Orin 的回环地址；这是当前无登录 Demo 的推荐访问方式。相同机器上的 app 和 bridge 使用 Humble；开发机浏览器无需安装相同 ROS 发行版。

## 4. 接入真实 app

停止 run_demo，再使用真实配置和 bridge：

```bash
source /opt/ros/humble/setup.bash
source ROS2/install/setup.bash
# 如有外部消息工作区，此处再 source 其 install/setup.bash
export ROS_DOMAIN_ID=77  # 必须替换为实际 app 的 domain
export ROS_LOCALHOST_ONLY=1  # app 同机时适用
ros2 run myroboview_platform bridge --config /absolute/path/orin-robot.json
```

对每个话题记录 `ros2 topic info -v` 结果、频率、消息示例、frame_id 和 QoS；至少核验 BatteryState、Imu、JointState、Odometry，以及选用的自定义状态。不要把 Mock 和真实 app 配置到相同话题同时运行。

## 5. 服务化（P2 实施时执行）

建议制品放 `/opt/myroboview/releases/<version>`，配置放 `/etc/myroboview/robot.json`，`/opt/myroboview/current` 指向当前版本。使用独立非 root 服务账号。下面是模板，部署时需先创建目录/账号、按真实 app 修改 domain，不能原样视为已经安装：

```ini
[Unit]
Description=MyRoboView ROS2 monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=myroboview
WorkingDirectory=/opt/myroboview/current
Environment=ROS_DOMAIN_ID=77
Environment=ROS_LOCALHOST_ONLY=1
ExecStart=/bin/bash -c 'source /opt/ros/humble/setup.bash && source /opt/myroboview/current/install/setup.bash && exec /opt/myroboview/current/install/myroboview_platform/lib/myroboview_platform/bridge --config /etc/myroboview/robot.json'
Restart=on-failure
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=10
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

安装制品必须是非 symlink 的独立 colcon install；开发脚本使用 symlink-install，不应直接删除其源码再当发布包运行。实际制品建议在最终版本目录原生执行 `colcon build --merge-install` 或保留包级目录的普通 `colcon build`，并按采用的布局修改 ExecStart（上述模板对应包级目录的普通构建）。

若使用自定义消息工作区，需要在启动命令 source 相应 overlay，或将消息包一起打包。确保服务用户与 app 的 DDS/共享内存权限兼容；通过日志诊断，不能仅因 systemd 显示 active 就判定话题正常。

## 6. 验收与回滚

- Mock/真实源切换，字段与 ROS CLI 一致。
- 单节点/单话题停止、超时、恢复；浏览器及 SSH 断连恢复。
- 测量 bridge CPU/RSS 和快照体积、首帧时间；不能使用 Mock 内的 cpu_percent 充当性能结果。
- 8 小时 MVP 运行，之后 24 小时平台长稳；监控真实资源、网络和日志增长。
- 重启设备后只启动 bridge，不自启动 Mock。
- 升级前保存旧制品和配置；失败时停服务、恢复 current 与匹配配置、重新启动并检查 HTTP+话题健康。

当前尚未实施的部署项、性能目标和真实话题适配见 [ROADMAP.md](ROADMAP.md)，以板端实际记录为验收依据。

## 前端部署范围

Demo 阶段只要求开发机复用 React 前端并代理到板端 API。后续可在开发机 `npm ci && npm run build`，将静态 build 部署到 Orin Nginx 并代理 `/api/` 到 127.0.0.1:8080；不需要在 Orin 运行 Node 开发服务器。静态站点、TLS 与权限配置属于后续部署加固，本轮不强求。
