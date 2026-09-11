#include "websocket_handler.h"
#include "auth_service.h"
#include "nav_manager.h"
#include "robot_state.h"
#include <drogon/drogon.h>
#include <json/json.h>
#include <ctime>
#include <iostream>
#include <sstream>
#include <vector>

using namespace drogon;
using namespace robot_monitor;

std::set<WebSocketConnectionPtr> WebSocketHandler::connections_;
std::mutex WebSocketHandler::connections_mutex_;

std::map<WebSocketConnectionPtr, std::set<std::string>>
    WebSocketHandler::page_subscriptions_;
std::mutex WebSocketHandler::page_subscriptions_mutex_;

void WebSocketHandler::handleNewConnection(
    const HttpRequestPtr& req, const WebSocketConnectionPtr& wsConnPtr) {
    const std::string token = req->getParameter("token");
    AuthClaims claims;
    if (!AuthService::instance().isLoaded() ||
        !AuthService::instance().verifyJwt(token, claims)) {
        std::cerr << "[WebSocket] Unauthorized WS from "
                  << wsConnPtr->peerAddr().toIpPort() << std::endl;
        wsConnPtr->forceClose();
        return;
    }

    std::lock_guard<std::mutex> lock(connections_mutex_);
    auto result = connections_.insert(wsConnPtr);

    if (result.second) {
        std::cout << "[WebSocket] Client connected: "
                  << wsConnPtr->peerAddr().toIpPort()
                  << " (Total connections: " << connections_.size() << ")"
                  << std::endl;
    } else {
        std::cout << "[WebSocket] Warning: Duplicate connection attempt from "
                  << wsConnPtr->peerAddr().toIpPort() << std::endl;
        return;
    }

    // 无论连接状态如何，都发送初始状态（前端连接时发送当前缓存的最新状态）
    auto& stateManager = RobotStateManager::getInstance();
    RobotState state = stateManager.getState();

    Json::Value json_state;
    json_state["connected"] = state.connected;  // 初始为false
    // 始终发送所有字段，确保前端能获取到完整状态
    json_state["status"] = state.status;
    json_state["mode"] = state.mode;
    json_state["action"] = state.action;
    json_state["running_status"] = state.running_status;
    json_state["motor_health"] = state.motor_health;
    // 初始状态只发送后端维护的电池信息
    json_state["battery_voltage"] = state.battery_voltage;
    json_state["remaining_power"] = state.remaining_power;
    json_state["current_temp"] = state.current_temp;

    // 初始关节槽位（显示名由前端按 id 映射，此处不下发 name）
    Json::Value joints(Json::arrayValue);
    for (const auto& joint : state.joints) {
        Json::Value j;
        j["id"] = joint.id;
        j["health"] = joint.health;
        j["motor_direction"] = joint.motor_direction;
        j["motor_temperature"] = joint.motor_temperature;
        j["mos_temperature"] = joint.mos_temperature;
        j["bus_voltage"] = joint.bus_voltage;
        j["u1_online"] = joint.u1_online;
        j["position_zero"] = joint.position_zero;
        joints.append(j);
    }
    json_state["joints"] = joints;

    WebSocketMessage msg;
    msg.type = "robot_state";
    msg.data = json_state;
    msg.timestamp = std::time(nullptr);

    Json::StreamWriterBuilder builder;
    builder["indentation"] = "";
    std::unique_ptr<Json::StreamWriter> writer(builder.newStreamWriter());
    std::ostringstream oss;
    writer->write(msg.toJson(), &oss);
    wsConnPtr->send(oss.str());

    std::cout << "[WebSocket] Sent initial state to new client (connected: "
              << (state.connected ? "true" : "false") << ")" << std::endl;
}

void WebSocketHandler::handleNewMessage(const WebSocketConnectionPtr& wsConnPtr,
                                        std::string&& message,
                                        const WebSocketMessageType& type) {
    if (type != WebSocketMessageType::Text) {
        return;
    }

    Json::Value json;
    Json::CharReaderBuilder readerBuilder;
    std::string errors;
    std::istringstream stream(message);
    std::unique_ptr<Json::CharReader> reader(readerBuilder.newCharReader());

    if (!reader->parse(message.c_str(), message.c_str() + message.length(),
                       &json, &errors)) {
        std::cerr << "Failed to parse WebSocket message: " << errors
                  << std::endl;
        return;
    }

    handleMessage(wsConnPtr, json);
}

void WebSocketHandler::handleMessage(const WebSocketConnectionPtr& wsConnPtr,
                                     const Json::Value& json) {
    WebSocketMessage msg = WebSocketMessage::fromJson(json);

    std::cout << "[WebSocket] Received message from "
              << wsConnPtr->peerAddr().toIpPort() << ": type=" << msg.type
              << std::endl;

    if (msg.type == "subscribe") {
        // 页面订阅
        if (msg.data.isMember("page")) {
            std::string page = msg.data["page"].asString();
            subscribePage(wsConnPtr, page);
            sendAck(wsConnPtr, "Subscribed to page: " + page);
            // 关键补偿：
            // navigation 页进入时，立即补发当前 nav_state 快照，
            // 避免前端必须等下一次状态变化才拿到地图名 / 位姿 / 任务状态。
            if (page == "navigation") {
                WebSocketMessage nav_msg;
                nav_msg.type = "nav_state";
                nav_msg.data = NavManager::getInstance().toJson();
                nav_msg.timestamp = std::time(nullptr);
                sendToConnection(wsConnPtr, nav_msg);
            }
        }
    } else if (msg.type == "unsubscribe") {
        // 取消订阅
        if (msg.data.isMember("page")) {
            std::string page = msg.data["page"].asString();
            unsubscribePage(wsConnPtr, page);
            sendAck(wsConnPtr, "Unsubscribed from page: " + page);
        } else {
            // 取消所有订阅
            unsubscribeAllPages(wsConnPtr);
            sendAck(wsConnPtr, "Unsubscribed from all pages");
        }
    }
    // 注：按钮/控制指令均通过 HTTP API 发送 LYOS IoT 话题，此处不再处理 command / set_joint_angle
}

void WebSocketHandler::handleConnectionClosed(
    const WebSocketConnectionPtr& wsConnPtr) {
    std::string peer_addr;
    size_t connection_count = 0;
    size_t subscription_count = 0;

    {
        std::lock_guard<std::mutex> lock(connections_mutex_);
        peer_addr = wsConnPtr->peerAddr().toIpPort();
        connections_.erase(wsConnPtr);
        connection_count = connections_.size();
    }

    // 清理页面订阅
    {
        std::lock_guard<std::mutex> lock(page_subscriptions_mutex_);
        auto it = page_subscriptions_.find(wsConnPtr);
        if (it != page_subscriptions_.end()) {
            subscription_count = it->second.size();
            page_subscriptions_.erase(it);
        }
    }

    std::cout << "[WebSocket] Client disconnected: " << peer_addr << " (had "
              << subscription_count << " page subscriptions)"
              << " (Remaining connections: " << connection_count << ")"
              << std::endl;
}

void WebSocketHandler::sendAck(const WebSocketConnectionPtr& wsConnPtr,
                               const std::string& message) {
    WebSocketMessage ack;
    ack.type = "ack";
    Json::Value data;
    data["message"] = message;
    ack.data = data;
    ack.timestamp = std::time(nullptr);

    Json::StreamWriterBuilder builder;
    builder["indentation"] = "";
    std::unique_ptr<Json::StreamWriter> writer(builder.newStreamWriter());
    std::ostringstream oss;
    writer->write(ack.toJson(), &oss);
    wsConnPtr->send(oss.str());
}

void WebSocketHandler::sendToConnection(const WebSocketConnectionPtr& conn,
                                        const WebSocketMessage& msg) {
    Json::StreamWriterBuilder builder;
    builder["indentation"] = "";
    std::unique_ptr<Json::StreamWriter> writer(builder.newStreamWriter());
    std::ostringstream oss;
    writer->write(msg.toJson(), &oss);

    try {
        conn->send(oss.str());
    } catch (const std::exception& e) {
        // 连接已断开，移除
        std::cerr << "[WebSocket] Failed to send message to "
                  << conn->peerAddr().toIpPort() << ": " << e.what()
                  << std::endl;
        {
            std::lock_guard<std::mutex> lock(connections_mutex_);
            connections_.erase(conn);
        }
        {
            std::lock_guard<std::mutex> lock(page_subscriptions_mutex_);
            page_subscriptions_.erase(conn);
        }
    } catch (...) {
        std::cerr << "[WebSocket] Failed to send message to "
                  << conn->peerAddr().toIpPort() << ": unknown error"
                  << std::endl;
        {
            std::lock_guard<std::mutex> lock(connections_mutex_);
            connections_.erase(conn);
        }
        {
            std::lock_guard<std::mutex> lock(page_subscriptions_mutex_);
            page_subscriptions_.erase(conn);
        }
    }
}

void WebSocketHandler::sendToPageSubscribers(const std::string& page,
                                             const WebSocketMessage& msg) {
    std::lock_guard<std::mutex> lock(page_subscriptions_mutex_);

    for (auto it = page_subscriptions_.begin();
         it != page_subscriptions_.end();) {
        auto conn = it->first;
        const auto& pages = it->second;

        if (pages.count(page) > 0) {
            sendToConnection(conn, msg);
            ++it;
        } else {
            ++it;
        }
    }
}

void WebSocketHandler::subscribePage(const WebSocketConnectionPtr& conn,
                                     const std::string& page) {
    std::lock_guard<std::mutex> lock(page_subscriptions_mutex_);
    page_subscriptions_[conn].insert(page);

    size_t total_subscribers = 0;
    for (const auto& [c, pages] : page_subscriptions_) {
        if (pages.count(page) > 0) {
            total_subscribers++;
        }
    }

    std::cout << "[WebSocket] Client " << conn->peerAddr().toIpPort()
              << " subscribed to page: " << page << " (Total subscribers for "
              << page << ": " << total_subscribers << ")" << std::endl;
}

void WebSocketHandler::unsubscribePage(const WebSocketConnectionPtr& conn,
                                       const std::string& page) {
    std::lock_guard<std::mutex> lock(page_subscriptions_mutex_);

    auto it = page_subscriptions_.find(conn);
    if (it != page_subscriptions_.end()) {
        it->second.erase(page);
        if (it->second.empty()) {
            page_subscriptions_.erase(it);
        }
    }

    size_t remaining_subscribers = 0;
    for (const auto& [c, pages] : page_subscriptions_) {
        if (pages.count(page) > 0) {
            remaining_subscribers++;
        }
    }

    std::cout << "[WebSocket] Client " << conn->peerAddr().toIpPort()
              << " unsubscribed from page: " << page
              << " (Remaining subscribers: " << remaining_subscribers << ")"
              << std::endl;
}

void WebSocketHandler::unsubscribeAllPages(const WebSocketConnectionPtr& conn) {
    std::lock_guard<std::mutex> lock(page_subscriptions_mutex_);

    auto it = page_subscriptions_.find(conn);
    if (it != page_subscriptions_.end()) {
        // 移除所有页面订阅
        page_subscriptions_.erase(it);
    }
}

// 统一消息广播（简化版）
void WebSocketHandler::broadcastMessage(const std::string& type,
                                        const Json::Value& data,
                                        const std::string& page) {
    WebSocketMessage msg;
    msg.type = type;
    msg.data = data;
    msg.timestamp = std::time(nullptr);

    size_t sent_count = 0;

    if (page.empty()) {
        // 广播给所有连接（如状态栏）
        // 注意：需要先复制连接列表，因为 sendToConnection
        // 可能会修改connections_列表
        std::vector<WebSocketConnectionPtr> conns_to_send;
        {
            std::lock_guard<std::mutex> lock(connections_mutex_);
            conns_to_send.reserve(connections_.size());
            for (const auto& conn : connections_) {
                conns_to_send.push_back(conn);
            }
        }
        // 发送消息（sendToConnection 会处理连接清理）
        for (const auto& conn : conns_to_send) {
            try {
                sendToConnection(conn, msg);
                sent_count++;
            } catch (...) {
                // sendToConnection 已经处理了连接清理
            }
        }
    } else {
        // 只发送给订阅了指定页面的连接
        std::lock_guard<std::mutex> lock(page_subscriptions_mutex_);
        for (auto it = page_subscriptions_.begin();
             it != page_subscriptions_.end();) {
            auto conn = it->first;
            const auto& pages = it->second;

            if (pages.count(page) > 0) {
                try {
                    sendToConnection(conn, msg);
                    sent_count++;
                    ++it;
                } catch (...) {
                    // 连接已断开，清理
                    it = page_subscriptions_.erase(it);
                    {
                        std::lock_guard<std::mutex> conn_lock(
                            connections_mutex_);
                        connections_.erase(conn);
                    }
                }
            } else {
                ++it;
            }
        }
        // 减少日志输出频率：对于高频数据不输出日志
        // robot_state 和 sensor_data 消息频率较高，不输出日志避免刷屏
        // 暂时关闭日志输出，避免后端日志刷屏
        // if (sent_count > 0 && type != "sensor_imu_frequency" &&
        //     type != "robot_state" && type != "motor_status_data" &&
        //     type != "log_data") {
        //     std::cout << "[WebSocket] Sent " << type << " to " << sent_count
        //               << " subscriber(s) of page: " << page << std::endl;
        // }
    }
}

void WebSocketHandler::addConnection(const WebSocketConnectionPtr& conn) {
    std::lock_guard<std::mutex> lock(connections_mutex_);
    connections_.insert(conn);
}

void WebSocketHandler::removeConnection(const WebSocketConnectionPtr& conn) {
    std::lock_guard<std::mutex> lock(connections_mutex_);
    connections_.erase(conn);
}

bool WebSocketHandler::hasConnections() {
    std::lock_guard<std::mutex> lock(connections_mutex_);
    return !connections_.empty();
}

bool WebSocketHandler::hasPageSubscribers(const std::string& page) {
    std::lock_guard<std::mutex> lock(page_subscriptions_mutex_);
    for (const auto& [conn, pages] : page_subscriptions_) {
        if (pages.count(page) > 0) {
            return true;
        }
    }
    return false;
}

// 注意：已移除定时器相关功能
// 状态广播改为在收到 Lyos 消息时直接广播（数据驱动）
// 超时检测由前端处理
