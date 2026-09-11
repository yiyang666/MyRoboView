#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace robot_monitor {

struct OfflineMapYaml {
    std::string image_file;  // 相对 yaml 的文件名
    double resolution = 0.05;
    double origin_x = 0;
    double origin_y = 0;
};

struct GrayImage {
    int width = 0;
    int height = 0;
    std::vector<uint8_t> pixels;  // row-major, 上到下
};

// 解析 ROS map_server 风格 yaml（image/resolution/origin）
bool parseOfflineMapYaml(const std::string& yaml_path, OfflineMapYaml& out,
                         std::string& error);

// 读取 P5 PGM
bool loadPgmFile(const std::string& pgm_path, GrayImage& out, std::string& error);

// 灰度图编码为 BMP（浏览器可直接显示）
bool encodeGrayBmp(const GrayImage& img, std::vector<uint8_t>& out_bmp,
                   std::string& error);

// 原样读文件字节（编辑器拉原始 PGM/YAML）
bool readFileBytes(const std::string& path, std::vector<uint8_t>& out,
                   std::string& error);

// 校验 body 是否以 P2/P5 魔数开头
bool looksLikePgm(const std::vector<uint8_t>& data);

// 原子写回磁盘（先写临时文件再 rename）
bool writeFileAtomic(const std::string& path, const std::vector<uint8_t>& data,
                     std::string& error);

// 与 SLAM 约定：离线地图目录内文件名固定，仅文件夹名不同
inline constexpr const char* kMap2dPgmName = "map_2d.pgm";
inline constexpr const char* kMap2dYamlName = "map_2d.yaml";

// 解析地图目录内的 map_2d.yaml / map_2d.pgm 绝对路径
bool resolveMap2dPaths(const std::string& map_dir, std::string& pgm_path,
                       std::string& yaml_path, std::string& error);

}  // namespace robot_monitor
