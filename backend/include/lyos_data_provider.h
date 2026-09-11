/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com (设计 by ChatGPT)
 * @Date: 2026-02-10
 * @Description: 主动从 Lyos 获取数据的服务（例如共享内存日志）
 */

#pragma once

#include <atomic>
#include <thread>

namespace robot_monitor {

/**
 * @brief LyosDataProvider
 *
 * 专门处理「主动从 Lyos 获取」的数据源，目前包括：
 *  - 共享内存日志（SHMLog）
 *
 * 职责：
 *  - 在后台线程中按需从 SHMLog 读取日志
 *  - 仅在有 WebSocket 日志页面订阅者时才读取并转发
 *  - 订阅从无到有时先丢弃 SHM 积压历史，只跟随后续新日志（类似 tail -f）
 *  - 通过 WebSocketHandler 广播为 "log_data" 消息，page = "logs"
 */
class LyosDataProvider {
public:
    static LyosDataProvider& instance();

    /// 启动所有「主动获取」数据的后台线程
    void start();

    /// 停止所有后台线程（在程序退出前调用）
    void stop();

private:
    LyosDataProvider() = default;
    ~LyosDataProvider();

    LyosDataProvider(const LyosDataProvider&) = delete;
    LyosDataProvider& operator=(const LyosDataProvider&) = delete;

    /// 日志共享内存读取线程主体
    void logThreadFunc();

    std::atomic<bool> log_running_{false};
    std::thread log_thread_;
};

} // namespace robot_monitor

