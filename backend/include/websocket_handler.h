/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-01-23 19:28:56
 * @LastEditors: marty marty.gong@lingyiitech.com
 * @LastEditTime: 2026-02-13 15:40:07
 * @FilePath: /build_all/src/roboview/backend/include/websocket_handler.h
 * @Description: WebSocket 处理器头文件
 */

#pragma once

#include <drogon/WebSocketController.h>
#include <drogon/HttpController.h>
#include <json/json.h>
#include "robot_state.h"
#include <set>
#include <map>
#include <mutex>

using namespace drogon;

namespace robot_monitor {

// WebSocket 消息类型
struct WebSocketMessage {
    std::string type;
    Json::Value data;
    std::string command_type;
    int64_t timestamp;

    Json::Value toJson() const {
        Json::Value json;
        json["type"] = type;
        json["data"] = data;
        if (!command_type.empty()) {
            json["command_type"] = command_type;
        }
        json["timestamp"] = static_cast<Json::Int64>(timestamp);
        return json;
    }

    static WebSocketMessage fromJson(const Json::Value& json) {
        WebSocketMessage msg;
        if (json.isMember("type")) {
            msg.type = json["type"].asString();
        }
        if (json.isMember("data")) {
            msg.data = json["data"];
        }
        if (json.isMember("command_type")) {
            msg.command_type = json["command_type"].asString();
        }
        if (json.isMember("timestamp")) {
            msg.timestamp = json["timestamp"].asInt64();
        } else {
            msg.timestamp = std::time(nullptr);
        }
        return msg;
    }
};

// WebSocket 控制器
class WebSocketHandler : public drogon::WebSocketController<WebSocketHandler> {
 public:
    // 新连接处理
    void handleNewConnection(const HttpRequestPtr& req,
                             const WebSocketConnectionPtr& wsConnPtr) override;

    // 新消息处理,来自客户端的请求
    void handleNewMessage(const WebSocketConnectionPtr& wsConnPtr,
                          std::string&& message,
                          const WebSocketMessageType& type) override;

    // 连接关闭处理
    void handleConnectionClosed(
        const WebSocketConnectionPtr& wsConnPtr) override;

    // 统一消息广播（简化版），用于发送机器人状态到所有订阅者
    static void broadcastMessage(const std::string& type,
                                 const Json::Value& data,
                                 const std::string& page = "");

    // 页面订阅管理
    static void subscribePage(const WebSocketConnectionPtr& conn,
                              const std::string& page);
    static void unsubscribePage(const WebSocketConnectionPtr& conn,
                                const std::string& page);
    static void unsubscribeAllPages(const WebSocketConnectionPtr& conn);

    // 添加连接
    static void addConnection(const WebSocketConnectionPtr& conn);

    // 移除连接
    static void removeConnection(const WebSocketConnectionPtr& conn);

    // 检查是否有客户端连接
    static bool hasConnections();

    // 检查指定页面是否有订阅者（用于按需发送数据）
    static bool hasPageSubscribers(const std::string& page);

    WS_PATH_LIST_BEGIN
    WS_PATH_ADD("/ws", Get);
    WS_PATH_LIST_END

 private:
    // 这个函数负责处理客户端发送的消息，并根据消息类型进行相应的处理，最终调用sendAck函数发送确认消息给客户端
    // 区别于RESTful
    // API，WebSocket消息是实时发送的，不需要等待响应，因此需要直接处理消息，而不是像RESTful
    // API那样需要等待响应
    // TODO：需要正确理解客户端的指令需求，采用合适的方式处理
    void handleMessage(const WebSocketConnectionPtr& wsConnPtr,
                       const Json::Value& json);
    void sendAck(const WebSocketConnectionPtr& wsConnPtr,
                 const std::string& message);

    // 发送消息给指定连接
    static void sendToConnection(const WebSocketConnectionPtr& conn,
                                 const WebSocketMessage& msg);

    // 发送消息给订阅了指定页面的所有连接
    static void sendToPageSubscribers(const std::string& page,
                                      const WebSocketMessage& msg);

    static std::set<WebSocketConnectionPtr> connections_;
    static std::mutex connections_mutex_;

    // 页面订阅映射：连接 -> 订阅的页面集合
    static std::map<WebSocketConnectionPtr, std::set<std::string>>
        page_subscriptions_;
    static std::mutex page_subscriptions_mutex_;
};

}  // namespace robot_monitor
