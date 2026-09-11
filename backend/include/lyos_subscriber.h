/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-01-23
 * @Description: Lyos 话题订阅器（简化版）
 */

#pragma once

#include <memory>
#include <thread>
#include <atomic>

namespace robot_monitor {

// Lyos 话题订阅器类
class LyosSubscriber {
public:
    LyosSubscriber();
    ~LyosSubscriber();
    
    // 初始化并启动订阅
    bool init();
    
    // 停止接收回调（在 lyos::shutdown() 之前调用）
    void disableSubscriptions();

    // 停止订阅
    void shutdown();
    
    // 检查是否已初始化
    bool isInitialized() const { return initialized_; }

private:
    // Lyos 事件循环线程
    void spinThread();
    
    std::atomic<bool> initialized_{false};
    std::atomic<bool> running_{false};
    std::thread spin_thread_;
    void* subscribers_data_ptr_;  // 指向订阅器数据的指针
};

} // namespace robot_monitor
