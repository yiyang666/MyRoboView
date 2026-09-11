#include "nav_map_io.h"

#include <cctype>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <unistd.h>

namespace robot_monitor {

namespace {

std::string trim(const std::string& s) {
    size_t b = 0;
    while (b < s.size() && std::isspace(static_cast<unsigned char>(s[b]))) ++b;
    size_t e = s.size();
    while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) --e;
    return s.substr(b, e - b);
}

bool parseOriginList(const std::string& value, double& x, double& y) {
    // 期望形如 [-21.8, -23.8, 0.0]
    std::string v = value;
    for (char& c : v) {
        if (c == '[' || c == ']' || c == ',') c = ' ';
    }
    std::istringstream iss(v);
    double z = 0;
    if (!(iss >> x >> y)) return false;
    iss >> z;  // z 可缺省
    return true;
}

}  // namespace

bool parseOfflineMapYaml(const std::string& yaml_path, OfflineMapYaml& out,
                         std::string& error) {
    std::ifstream ifs(yaml_path);
    if (!ifs) {
        error = "cannot open yaml: " + yaml_path;
        return false;
    }
    std::string line;
    bool got_image = false;
    bool got_res = false;
    bool got_origin = false;
    while (std::getline(ifs, line)) {
        line = trim(line);
        if (line.empty() || line[0] == '#') continue;
        const auto colon = line.find(':');
        if (colon == std::string::npos) continue;
        const std::string key = trim(line.substr(0, colon));
        std::string val = trim(line.substr(colon + 1));
        // 去掉引号
        if (val.size() >= 2 &&
            ((val.front() == '"' && val.back() == '"') ||
             (val.front() == '\'' && val.back() == '\''))) {
            val = val.substr(1, val.size() - 2);
        }
        if (key == "image") {
            out.image_file = val;
            got_image = true;
        } else if (key == "resolution") {
            out.resolution = std::stod(val);
            got_res = true;
        } else if (key == "origin") {
            if (!parseOriginList(val, out.origin_x, out.origin_y)) {
                error = "invalid origin in " + yaml_path;
                return false;
            }
            got_origin = true;
        }
    }
    if (!got_image || !got_res || !got_origin) {
        error = "yaml missing image/resolution/origin: " + yaml_path;
        return false;
    }
    return true;
}

bool loadPgmFile(const std::string& pgm_path, GrayImage& out, std::string& error) {
    std::ifstream ifs(pgm_path, std::ios::binary);
    if (!ifs) {
        error = "cannot open pgm: " + pgm_path;
        return false;
    }

    auto readToken = [&](std::string& tok) -> bool {
        tok.clear();
        char c = 0;
        // 跳过空白与注释
        while (ifs.get(c)) {
            if (c == '#') {
                while (ifs.get(c) && c != '\n') {
                }
                continue;
            }
            if (!std::isspace(static_cast<unsigned char>(c))) {
                tok.push_back(c);
                break;
            }
        }
        if (tok.empty()) return false;
        while (ifs.get(c)) {
            if (std::isspace(static_cast<unsigned char>(c))) break;
            tok.push_back(c);
        }
        return true;
    };

    std::string magic;
    if (!readToken(magic) || magic != "P5") {
        error = "unsupported pgm magic (need P5): " + pgm_path;
        return false;
    }
    std::string w_s, h_s, max_s;
    if (!readToken(w_s) || !readToken(h_s) || !readToken(max_s)) {
        error = "invalid pgm header: " + pgm_path;
        return false;
    }
    const int w = std::stoi(w_s);
    const int h = std::stoi(h_s);
    const int maxv = std::stoi(max_s);
    if (w <= 0 || h <= 0 || maxv <= 0 || maxv > 255) {
        error = "invalid pgm size/maxval: " + pgm_path;
        return false;
    }

    out.width = w;
    out.height = h;
    out.pixels.resize(static_cast<size_t>(w) * static_cast<size_t>(h));
    ifs.read(reinterpret_cast<char*>(out.pixels.data()),
             static_cast<std::streamsize>(out.pixels.size()));
    if (!ifs) {
        error = "pgm pixel read failed: " + pgm_path;
        return false;
    }
    return true;
}

bool encodeGrayBmp(const GrayImage& img, std::vector<uint8_t>& out_bmp,
                   std::string& error) {
    if (img.width <= 0 || img.height <= 0 ||
        img.pixels.size() !=
            static_cast<size_t>(img.width) * static_cast<size_t>(img.height)) {
        error = "invalid gray image for bmp encode";
        return false;
    }

    const int w = img.width;
    const int h = img.height;
    // 每行 4 字节对齐的 BGR
    const int row_stride = (w * 3 + 3) & ~3;
    const int pixel_bytes = row_stride * h;
    const int file_size = 14 + 40 + pixel_bytes;

    out_bmp.assign(static_cast<size_t>(file_size), 0);
    auto put16 = [&](size_t off, uint16_t v) {
        out_bmp[off] = static_cast<uint8_t>(v & 0xff);
        out_bmp[off + 1] = static_cast<uint8_t>((v >> 8) & 0xff);
    };
    auto put32 = [&](size_t off, uint32_t v) {
        out_bmp[off] = static_cast<uint8_t>(v & 0xff);
        out_bmp[off + 1] = static_cast<uint8_t>((v >> 8) & 0xff);
        out_bmp[off + 2] = static_cast<uint8_t>((v >> 16) & 0xff);
        out_bmp[off + 3] = static_cast<uint8_t>((v >> 24) & 0xff);
    };

    // BITMAPFILEHEADER
    out_bmp[0] = 'B';
    out_bmp[1] = 'M';
    put32(2, static_cast<uint32_t>(file_size));
    put32(10, 14 + 40);
    // BITMAPINFOHEADER
    put32(14, 40);
    put32(18, static_cast<uint32_t>(w));
    put32(22, static_cast<uint32_t>(h));  // 正高度：底向上存储
    put16(26, 1);
    put16(28, 24);
    put32(34, static_cast<uint32_t>(pixel_bytes));

    // BMP 底行优先；PGM 顶行优先 → 翻转
    uint8_t* dst_base = out_bmp.data() + 54;
    for (int y = 0; y < h; ++y) {
        const int src_y = y;  // pgm top-first
        const int dst_y = h - 1 - y;
        const uint8_t* src = img.pixels.data() + src_y * w;
        uint8_t* dst = dst_base + dst_y * row_stride;
        for (int x = 0; x < w; ++x) {
            const uint8_t g = src[x];
            dst[x * 3 + 0] = g;
            dst[x * 3 + 1] = g;
            dst[x * 3 + 2] = g;
        }
    }
    return true;
}

bool readFileBytes(const std::string& path, std::vector<uint8_t>& out,
                   std::string& error) {
    std::ifstream ifs(path, std::ios::binary);
    if (!ifs) {
        error = "cannot open file: " + path;
        return false;
    }
    ifs.seekg(0, std::ios::end);
    const auto sz = ifs.tellg();
    if (sz < 0) {
        error = "cannot stat file: " + path;
        return false;
    }
    ifs.seekg(0, std::ios::beg);
    out.resize(static_cast<size_t>(sz));
    if (sz > 0) {
        ifs.read(reinterpret_cast<char*>(out.data()), sz);
        if (!ifs) {
            error = "file read failed: " + path;
            return false;
        }
    }
    return true;
}

bool looksLikePgm(const std::vector<uint8_t>& data) {
    // 魔数 P2 / P5，后接空白
    if (data.size() < 3) return false;
    if (data[0] != 'P') return false;
    if (data[1] != '2' && data[1] != '5') return false;
    return std::isspace(static_cast<unsigned char>(data[2])) != 0;
}

bool writeFileAtomic(const std::string& path, const std::vector<uint8_t>& data,
                     std::string& error) {
    namespace fs = std::filesystem;
    const fs::path target(path);
    const fs::path parent = target.parent_path();
    if (!parent.empty() && !fs::exists(parent)) {
        error = "parent directory missing: " + parent.string();
        return false;
    }
    const fs::path tmp =
        parent / (target.filename().string() + ".tmp." + std::to_string(::getpid()));
    {
        std::ofstream ofs(tmp, std::ios::binary | std::ios::trunc);
        if (!ofs) {
            error = "cannot open temp file: " + tmp.string();
            return false;
        }
        if (!data.empty()) {
            ofs.write(reinterpret_cast<const char*>(data.data()),
                      static_cast<std::streamsize>(data.size()));
            if (!ofs) {
                error = "temp file write failed: " + tmp.string();
                fs::remove(tmp);
                return false;
            }
        }
    }
    std::error_code ec;
    fs::rename(tmp, target, ec);
    if (ec) {
        error = "rename failed: " + ec.message();
        fs::remove(tmp);
        return false;
    }
    return true;
}

bool resolveMap2dPaths(const std::string& map_dir, std::string& pgm_path,
                       std::string& yaml_path, std::string& error) {
    namespace fs = std::filesystem;
    const fs::path dir(map_dir);
    if (!fs::exists(dir) || !fs::is_directory(dir)) {
        error = "map directory not found: " + map_dir;
        return false;
    }
    const fs::path pgm = dir / kMap2dPgmName;
    const fs::path yaml = dir / kMap2dYamlName;
    if (!fs::exists(pgm) || !fs::is_regular_file(pgm)) {
        error = std::string("missing ") + kMap2dPgmName + " in: " + map_dir;
        return false;
    }
    if (!fs::exists(yaml) || !fs::is_regular_file(yaml)) {
        error = std::string("missing ") + kMap2dYamlName + " in: " + map_dir;
        return false;
    }
    pgm_path = pgm.string();
    yaml_path = yaml.string();
    return true;
}

}  // namespace robot_monitor
