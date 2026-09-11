# Drogon 框架安装指南

## 📦 快速安装

本项目推荐使用**源码编译**方式安装 Drogon。详细安装说明请参考：

**[Drogon 官方安装文档](https://github.com/drogonframework/drogon/wiki/Installation)**

## 🚀 快速安装步骤

### 1. 安装系统依赖

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install -y \
    build-essential \
    cmake \
    libssl-dev \
    libjsoncpp-dev \
    libjsoncpp25 \
    uuid-dev \
    zlib1g-dev \
    libbrotli-dev \
    libc-ares-dev \
    libpq-dev
```

### 2. 编译并安装 Drogon

```bash
# 克隆仓库（使用 --recursive 自动初始化子模块）
cd ~ # 选择某个路径
git clone --recursive https://github.com/drogonframework/drogon.git
cd drogon

# 创建构建目录
mkdir build && cd build

# 配置（只安装必要的组件，加快编译）
cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/usr/local \
    -DBUILD_SHARED_LIBS=ON \
    -DBUILD_CTL=OFF \
    -DBUILD_EXAMPLES=OFF
    # -DBUILD_ORM=OFF 禁用数据库

# 编译（使用多核加速）
make -j$(nproc)

# 安装到系统路径（默认 /usr/local）
sudo make install

# 更新动态库缓存
sudo ldconfig
```

### 3. 验证安装

```bash
# 检查库文件
ls /usr/local/lib/libdrogon*

# 检查 CMake 配置
ls /usr/local/lib/cmake/Drogon/
```

### 4. 清理源码目录（可选）

安装完成后，可以删除源码目录以节省空间：

```bash
cd ~
rm -rf drogon
```

## 🐛 常见问题

### 问题 1: 找不到 Drogon

**错误信息:**
```
CMake Error: Could not find a package configuration file provided by "Drogon"
```

**解决方案:**
```bash
# 确保已正确安装
ls /usr/local/lib/cmake/Drogon/

# 如果安装在其他路径，设置 CMAKE_PREFIX_PATH
export CMAKE_PREFIX_PATH=/usr/local:$CMAKE_PREFIX_PATH

# 更新动态库缓存
sudo ldconfig
```

### 问题 2: 找不到 trantor 子模块

**错误信息:**
```
CMake Error: The source directory .../trantor does not contain a CMakeLists.txt file.
```

**解决方案:**
```bash
# 如果已经克隆了但没有子模块，初始化子模块
cd ~/drogon
git submodule update --init --recursive

# 或者重新克隆（推荐）
rm -rf ~/drogon
git clone --recursive https://github.com/drogonframework/drogon.git
```

### 问题 3: 找不到 c-ares

**错误信息:**
```
Could NOT find c-ares (missing: C-ARES_INCLUDE_DIRS C-ARES_LIBRARIES)
```

**解决方案:**
```bash
# Ubuntu/Debian
sudo apt-get install libc-ares-dev

# CentOS/RHEL
sudo yum install c-ares-devel
```

### 问题 4: 找不到 jsoncpp

```bash
# Ubuntu/Debian
sudo apt-get install libjsoncpp-dev

# CentOS/RHEL
sudo yum install jsoncpp-devel
```

## 📚 更多信息

- [Drogon 官方安装文档](https://github.com/drogonframework/drogon/wiki/Installation)
- [Drogon GitHub](https://github.com/drogonframework/drogon)
- [Drogon 官方文档](https://drogon.docsforge.com/)
