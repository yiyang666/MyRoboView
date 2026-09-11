/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-02-10 19:12:43
 * @LastEditors: marty marty.gong@lingyiitech.com
 * @LastEditTime: 2026-02-13 15:41:08
 * @FilePath: /build_all/src/roboview/backend/src/lyos_data_provider.cpp
 * @Description: 主动从 Lyos 获取数据的服务实现（共享内存日志）
 */

#include "lyos_data_provider.h"
#include "websocket_handler.h"
#include <lyos/share_memory/shmlog.h>
#include <json/json.h>
#include <chrono>
#include <iostream>
#include <regex>

namespace robot_monitor {

// 日志读取速度控制超参数
constexpr int LOG_READ_SPEED = 10;  // 单位 ms

// 辅助函数：解析日志行，提取时间戳、等级、进程名等信息
// 日志格式：YYYY-MM-DD HH:MM:SS.mmm LEVEL/process_name(pid/tid): file.cpp(line)
// clk(timestamp) message 例如：2026-02-10 19:12:43.914 E/lyos_app(2166/2185):
// iot_rccontroller_impl.cpp(940) clk(9694.393642592) Failed to reconnect...
struct ParsedLog {
    int64_t timestamp_ms;  // 解析出的时间戳（毫秒）
    std::string level;     // error, warn, info, debug
    std::string source;    // 进程名（如 lyos_app, motor_driver）
    std::string message;   // 完整原始日志行
};

static ParsedLog parseLogLine(const std::string& line) {
    ParsedLog parsed;
    parsed.message = line;  // 保留完整原始日志

    // 默认值
    parsed.level = "info";
    parsed.source = "";

    // 使用当前时间作为时间戳,单位为毫秒,意为当前读取该条日志的时间
    auto now = std::chrono::system_clock::now();
    parsed.timestamp_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                              now.time_since_epoch())
                              .count();

    // 正则表达式匹配日志格式，提取等级和进程名：
    // 等级: E/I/W/D/F (F=Fatal)
    // 进程名: process_name (可能为空，如 "I/(466164/466164):")
    // 例如：2026-02-10 19:12:43.914 E/lyos_app(2166/2185): ...
    // 例如：2026-02-10 19:44:26.755 F/robot_monitor_backend(462761/462761): ...
    // 例如：2026-02-10 19:44:28.060 I/(466164/466164): ...
    std::regex log_pattern(R"(\s+([EIWDF])/([^(]*?)\([^)]+\):)");

    std::smatch matches;
    if (std::regex_search(line, matches, log_pattern) && matches.size() >= 3) {
        // 解析等级
        std::string level_char = matches[1].str();
        if (level_char == "E" || level_char == "F") {
            parsed.level = "error";
        } else if (level_char == "W") {
            parsed.level = "warn";
        } else if (level_char == "I") {
            parsed.level = "info";
        } else if (level_char == "D") {
            parsed.level = "debug";
        }

        // 解析进程名（可能为空）
        parsed.source = matches[2].str();
    } else {
        // 如果正则匹配失败，使用简单字符串匹配等级（兼容性处理）
        if (line.find(" F/") != std::string::npos ||
            line.find(" E/") != std::string::npos) {
            parsed.level = "error";
        } else if (line.find(" W/") != std::string::npos) {
            parsed.level = "warn";
        } else if (line.find(" I/") != std::string::npos) {
            parsed.level = "info";
        } else if (line.find(" D/") != std::string::npos) {
            parsed.level = "debug";
        }
    }

    return parsed;
}

// 将只读游标追到写端，丢弃积压历史；不消费共享队列，不影响其他读进程
static void skipToLatest(lyos::SHMLog* shmLog, const std::atomic<bool>& running) {
    if (shmLog == nullptr) {
        return;
    }
    std::string discard;
    int skipped = 0;
    while (running.load() && shmLog->readMessage(discard) > 0) {
        ++skipped;
    }
    std::cout << "[LyosDataProvider] Skipped " << skipped
              << " historical log(s), following latest" << std::endl;
}

LyosDataProvider& LyosDataProvider::instance() {
    static LyosDataProvider inst;
    return inst;
}

void LyosDataProvider::start() {
    // 日志线程
    if (!log_running_.exchange(true)) {
        log_thread_ = std::thread(&LyosDataProvider::logThreadFunc, this);
    }
}

void LyosDataProvider::stop() {
    // 停止日志线程
    if (log_running_.exchange(false)) {
        if (log_thread_.joinable()) {
            log_thread_.join();
        }
    }
}

LyosDataProvider::~LyosDataProvider() { stop(); }

void LyosDataProvider::logThreadFunc() {
    auto* shmLog = lyos::SHMLog::getInstance();
    if (shmLog == nullptr) {
        std::cerr
            << "[LyosDataProvider] SHMLog instance is null, log thread exit"
            << std::endl;
        return;
    }

    uint64_t log_id = 0;
    // 订阅状态边沿触发：仅在「无订阅 ↔ 有订阅」切换时各打一次，避免刷屏
    bool was_ready = false;
    bool logged_waiting = false;

    std::cout << "[LyosDataProvider] Log thread started" << std::endl;

    while (log_running_) {
        // 仅在有 WebSocket 连接且有日志页面订阅者时才读取共享内存
        bool has_connections = WebSocketHandler::hasConnections();
        bool has_subscribers = WebSocketHandler::hasPageSubscribers("logs");
        bool ready = has_connections && has_subscribers;

        if (!ready) {
            if (!logged_waiting) {
                std::cout
                    << "[LyosDataProvider] Waiting for Log Subscribers... "
                    << "(connections: " << (has_connections ? "yes" : "no")
                    << ", logs subscribers: "
                    << (has_subscribers ? "yes" : "no") << ")" << std::endl;
                logged_waiting = true;
            }
            was_ready = false;
            std::this_thread::sleep_for(std::chrono::seconds(1));
            continue;
        }

        if (!was_ready) {
            std::cout << "[LyosDataProvider] Subscriber detected, skipping "
                         "history then following latest"
                      << std::endl;
            skipToLatest(shmLog, log_running_);
            was_ready = true;
            logged_waiting = false;  // 下次再进入无订阅时允许再打一次 Waiting
        }

        std::string line;
        int ret = shmLog->readMessage(line);
        if (ret <= 0) {
            // 暂无新日志，稍作休眠避免空转
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            continue;
        }
        // 打印测试
        // std::cout << "[LyosDataProvider] Read log: " << line << std::endl;

        // 解析日志行，提取时间戳、等级、进程名等信息
        ParsedLog parsed = parseLogLine(line);

        // 构造 JSON 消息
        Json::Value json_log;
        json_log["id"] = static_cast<Json::UInt64>(log_id++);
        json_log["timestamp"] = static_cast<Json::Int64>(parsed.timestamp_ms);
        json_log["level"] = parsed.level;
        json_log["message"] =
            parsed.message;  // 完整原始日志行，前端用于正则筛选
        json_log["source"] = parsed.source;  // 进程名，前端也可用于筛选

        // 只发送给订阅了日志页面的客户端
        WebSocketHandler::broadcastMessage("log_data", json_log, "logs");

        // 控制读取速度：每处理一条日志后稍作延迟
        std::this_thread::sleep_for(std::chrono::milliseconds(LOG_READ_SPEED));
    }

    std::cout << "[LyosDataProvider] Log thread stopped" << std::endl;
}

}  // namespace robot_monitor
