# 环境部署文档

本文档详细说明如何从 Git 仓库克隆项目后，完成所有依赖安装、框架配置，并成功运行整个项目。
注意：针对的是x86_64的开发环境配置！！！！

## 📋 目录

- [前置条件检查](#前置条件检查)
- [1. 从 Git 克隆项目](#1-从-git-克隆项目)
- [2. 安装系统依赖](#2-安装系统依赖)
- [3. 安装 Drogon 后端框架](#3-安装-drogon-后端框架)
- [4. 安装前端依赖](#4-安装前端依赖)
- [5. 构建和运行项目](#5-构建和运行项目)
- [6. 验证部署](#6-验证部署)
- [常见问题排查](#常见问题排查)

---

## 前置条件检查

在开始部署之前，请确保您的系统满足以下要求：

- **操作系统**: Ubuntu 20.04+ / Debian 11+ / CentOS 8+ / 或其他 Linux 发行版
- **权限**: 需要 sudo 权限以安装系统依赖
- **网络**: 能够访问互联网以下载依赖包

---

## 1. 从 Git 克隆项目

```bash
# 克隆项目到本地（替换为实际的仓库地址）
git clone <repository-url> roboview
cd roboview
```

---

## 2. 安装系统依赖

### 2.1 安装基础构建工具

**Ubuntu/Debian 系统:**

```bash
sudo apt-get update
sudo apt-get install -y \
    build-essential \
    cmake \
    git \
    curl \
    wget
```

### 2.2 安装 Node.js 和 npm

本项目需要 Node.js >= 16.0.0 和 npm >= 8.0.0。

**方法一：使用 NodeSource 仓库（推荐）**

```bash
# 安装 Node.js 18.x LTS 版本
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node --version
npm --version
```

### 2.3 安装 Drogon 依赖库

**Ubuntu/Debian 系统:**

```bash
sudo apt-get install -y \
    libssl-dev \
    libjsoncpp-dev \
    libjsoncpp25 \
    uuid-dev \
    zlib1g-dev \
    libbrotli-dev \
    libc-ares-dev \
    libpq-dev
```

---

## 3. 安装 Drogon 后端框架

Drogon 是一个基于 C++17 的现代 Web 框架，需要从源码编译安装。

### 3.1 克隆 Drogon 源码

```bash
# 选择一个合适的目录（例如用户主目录）
cd ~

# 克隆 Drogon 仓库（使用 --recursive 自动初始化子模块）
git clone --recursive https://github.com/drogonframework/drogon.git
cd drogon
```

### 3.2 编译并安装 Drogon

```bash
# 创建构建目录
mkdir build && cd build

# 配置 CMake（只安装必要的组件，加快编译）
cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/usr/local \
    -DBUILD_SHARED_LIBS=ON \
    -DBUILD_CTL=OFF \
    -DBUILD_EXAMPLES=OFF

# 编译（使用多核加速，根据 CPU 核心数调整）
make -j$(nproc)

# 安装到系统路径（需要 sudo 权限）
sudo make install

# 更新动态库缓存
sudo ldconfig
```

### 3.3 验证 Drogon 安装

```bash
# 检查库文件
ls /usr/local/lib/libdrogon*

# 检查 CMake 配置
ls /usr/local/lib/cmake/Drogon/

# 如果上述命令有输出，说明安装成功
```

### 3.4 清理 Drogon 源码（可选）

安装完成后，可以删除源码目录以节省空间：

```bash
cd ~
rm -rf drogon
```

**注意**: 如果后续需要重新编译 Drogon，请保留源码目录。

---

## 4. 安装前端依赖

### 4.1 配置 npm 镜像（可选，加快下载速度）

如果在中国大陆，建议使用国内镜像：

```bash
npm config set registry https://registry.npmmirror.com
```

### 4.2 安装前端依赖

```bash
# 进入前端目录
cd roboview/my-app

# 安装依赖（首次安装可能需要几分钟）
npm install
```

**预期输出**: 依赖安装完成后，会生成 `node_modules` 目录。

---

## 5. 构建和运行项目

### 5.1 构建后端

```bash
# 进入后端目录
cd roboview/backend

# 使用 Makefile 构建（首次构建可能需要几分钟）
make build
```

**预期输出**: 构建成功后，会在 `backend/build/` 目录下生成可执行文件 `robot_monitor_backend`。

**如果构建失败**，请检查：
- Drogon 是否正确安装（参考 [3.3 验证 Drogon 安装](#33-验证-drogon-安装)）
- 所有依赖库是否已安装（参考 [2.3 安装 Drogon 依赖库](#23-安装-drogon-依赖库)）

### 5.2 运行项目

#### 方法一：使用一键启动脚本（推荐）

```bash
# 在项目根目录
cd roboview

# 赋予执行权限（首次运行）
chmod +x start_dev.sh

# 启动开发环境（会自动启动前端和后端）
./start_dev.sh
```

脚本会自动：
1. 检查环境依赖
2. 构建后端（如果需要）
3. 启动后端服务（端口 8080）
4. 启动前端服务（端口 3000）

#### 方法二：手动启动

**终端 1 - 启动后端:**

```bash
cd roboview/backend
make run
# 或直接运行
./build/robot_monitor_backend
```

**终端 2 - 启动前端:**

```bash
cd roboview/my-app
npm start
```

---

## 6. 验证部署

### 6.1 检查服务状态

**后端服务:**
- 默认运行在 `http://localhost:8080`
- 测试 API: `curl http://localhost:8080/api/v1/status`

**前端服务:**
- 默认运行在 `http://localhost:3000`
- 浏览器访问: `http://localhost:3000`

### 6.2 检查端口占用

如果端口被占用，可以使用以下命令查找并结束进程：

```bash
# 查找占用 8080 端口的进程（后端）
lsof -i :8080

# 查找占用 3000 端口的进程（前端）
lsof -i :3000

# 结束进程（替换 <PID> 为实际进程 ID）
kill -9 <PID>
```

---

## 常见问题排查

### 问题 1: CMake 找不到 Drogon

**错误信息:**
```
CMake Error: Could not find a package configuration file provided by "Drogon"
```

**解决方案:**

```bash
# 确保 Drogon 已正确安装
ls /usr/local/lib/cmake/Drogon/

# 如果文件不存在，重新安装 Drogon（参考步骤 3）

# 更新动态库缓存
sudo ldconfig

# 如果安装在其他路径，设置环境变量
export CMAKE_PREFIX_PATH=/usr/local:$CMAKE_PREFIX_PATH
```

### 问题 2: 找不到 jsoncpp

**错误信息:**
```
Could NOT find jsoncpp (missing: jsoncpp_INCLUDE_DIRS jsoncpp_LIBRARIES)
```

**解决方案:**

```bash
# Ubuntu/Debian
sudo apt-get install libjsoncpp-dev

# CentOS/RHEL
sudo yum install jsoncpp-devel

# 重新构建后端
cd roboview/backend
make clean
make build
```

### 问题 3: npm 安装慢或失败

**解决方案:**

```bash
# 使用国内镜像
npm config set registry https://registry.npmmirror.com

# 清除 npm 缓存
npm cache clean --force

# 重新安装
cd roboview/my-app
rm -rf node_modules package-lock.json
npm install
```

### 问题 4: Node.js 版本过低

**错误信息:**
```
Error: The engine "node" is incompatible with this module
```

**解决方案:**

```bash
# 检查当前版本
node --version

# 如果版本 < 16.0.0，升级 Node.js（参考步骤 2.2）
```

### 问题 5: 编译 Drogon 时找不到子模块

**错误信息:**
```
CMake Error: The source directory .../trantor does not contain a CMakeLists.txt file.
```

**解决方案:**

```bash
# 进入 Drogon 源码目录
cd ~/drogon

# 初始化子模块
git submodule update --init --recursive

# 重新编译（参考步骤 3.2）
```

### 问题 6: 权限不足

**错误信息:**
```
Permission denied
```

**解决方案:**

```bash
# 确保脚本有执行权限
chmod +x start_dev.sh

# 确保后端可执行文件有执行权限
chmod +x backend/build/robot_monitor_backend
```

### 问题 7: 端口已被占用

**解决方案:**

```bash
# 查找占用端口的进程
lsof -i :8080  # 后端端口
lsof -i :3000  # 前端端口

# 结束进程
kill -9 <PID>

# 或者修改配置文件使用其他端口
```

---

## 📚 相关文档

- [项目 README](README.md) - 项目总体说明
- [系统架构文档](ARCHITECTURE.md) - 系统架构详解
- [后端 README](backend/README.md) - 后端 API 文档
- [Drogon 安装指南](backend/INSTALL_DROGON.md) - Drogon 详细安装说明
- [Drogon 官方文档](https://drogon.docsforge.com/) - Drogon 框架官方文档

---

## ✅ 部署检查清单

完成以下所有步骤后，您的环境应该已完全配置好：

- [ ] Git 仓库已克隆
- [ ] 系统依赖已安装（build-essential, cmake 等）
- [ ] Node.js >= 16.0.0 已安装
- [ ] npm >= 8.0.0 已安装
- [ ] Drogon 依赖库已安装（libssl-dev, libjsoncpp-dev 等）
- [ ] Drogon 框架已编译并安装到系统
- [ ] 前端依赖已安装（npm install）
- [ ] 后端已成功构建（make build）
- [ ] 后端服务可以启动（端口 8080）
- [ ] 前端服务可以启动（端口 3000）
- [ ] 浏览器可以访问 `http://localhost:3000`

---

**最后更新**: 2026-01-26

**文档维护**: 如有问题或建议，请联系开发团队。
