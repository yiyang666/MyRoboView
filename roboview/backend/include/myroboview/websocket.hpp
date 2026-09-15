#pragma once
#include "myroboview/core.hpp"
#include <drogon/WebSocketController.h>
#include <set>

namespace myroboview {
class BroadcastHub {
 public:
    void add(const drogon::WebSocketConnectionPtr &connection);
    void remove(const drogon::WebSocketConnectionPtr &connection);
    void broadcast(const Json::Value &frame);

 private:
    std::mutex mutex_;
    std::set<drogon::WebSocketConnectionPtr> clients_;
};
class TelemetrySocket
    : public drogon::WebSocketController<TelemetrySocket, false> {
 public:
    TelemetrySocket(std::shared_ptr<BroadcastHub> hub,
                    std::shared_ptr<StateStore> store)
        : hub_(std::move(hub)), store_(std::move(store)) {}
    void handleNewConnection(const drogon::HttpRequestPtr &,
                             const drogon::WebSocketConnectionPtr &) override;
    void handleConnectionClosed(
        const drogon::WebSocketConnectionPtr &) override;
    void handleNewMessage(const drogon::WebSocketConnectionPtr &,
                          std::string &&,
                          const drogon::WebSocketMessageType &) override;
    WS_PATH_LIST_BEGIN
    WS_PATH_ADD("/ws");
    WS_PATH_ADD("/api/v1/telemetry");
    WS_PATH_LIST_END
 private:
    std::shared_ptr<BroadcastHub> hub_;
    std::shared_ptr<StateStore> store_;
};
}  // namespace myroboview
