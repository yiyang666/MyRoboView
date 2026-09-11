/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-01-27
 * @Description: 统一数据管理器（JSON 格式，简化设计）
 */

#pragma once

#include <jsoncpp/json/json.h>
#include <mutex>
#include <atomic>
#include <set>
#include <string>

namespace robot_monitor {

// 统一数据管理器（线程安全）
class DataManager {
public:
    static DataManager& getInstance() {
        static DataManager instance;
        return instance;
    }
    
    // 检查页面是否有订阅者
    bool hasPageSubscribers(const std::string& page) const {
        std::lock_guard<std::mutex> lock(mutex_);
        return page_subscribers_.count(page) > 0;
    }
    
    // 添加页面订阅
    void addPageSubscriber(const std::string& page) {
        std::lock_guard<std::mutex> lock(mutex_);
        page_subscribers_.insert(page);
    }
    
    // 移除页面订阅
    void removePageSubscriber(const std::string& page) {
        std::lock_guard<std::mutex> lock(mutex_);
        page_subscribers_.erase(page);
    }
    
private:
    DataManager() = default;
    ~DataManager() = default;
    
    DataManager(const DataManager&) = delete;
    DataManager& operator=(const DataManager&) = delete;
    
    mutable std::mutex mutex_;
    std::set<std::string> page_subscribers_;  // 订阅的页面集合
};

} // namespace robot_monitor
