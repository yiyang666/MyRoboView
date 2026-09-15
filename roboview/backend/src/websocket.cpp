#include "myroboview/websocket.hpp"
namespace myroboview {
void BroadcastHub::add(const drogon::WebSocketConnectionPtr &connection) {
    std::lock_guard<std::mutex> lock(mutex_);
    clients_.insert(connection);
}
void BroadcastHub::remove(const drogon::WebSocketConnectionPtr &connection) {
    std::lock_guard<std::mutex> lock(mutex_);
    clients_.erase(connection);
}
void BroadcastHub::broadcast(const Json::Value &frame) {
    const auto payload = encode(frame);
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto &client : clients_)
        if (client->connected()) client->send(payload);
}
void TelemetrySocket::handleNewConnection(
    const drogon::HttpRequestPtr &,
    const drogon::WebSocketConnectionPtr &connection) {
    Json::Value hello;
    hello["type"] = "hello";
    hello["schema_version"] = 2;
    hello["snapshot"] = store_->snapshot();
    connection->send(encode(hello));
    hub_->add(connection);
}
void TelemetrySocket::handleConnectionClosed(
    const drogon::WebSocketConnectionPtr &connection) {
    hub_->remove(connection);
}
void TelemetrySocket::handleNewMessage(
    const drogon::WebSocketConnectionPtr &connection, std::string &&,
    const drogon::WebSocketMessageType &type) {
    if (type == drogon::WebSocketMessageType::Text ||
        type == drogon::WebSocketMessageType::Binary)
        connection->send(
            "{\"type\":\"error\",\"message\":\"Telemetry socket is server-push "
            "only; use demo navigation HTTP endpoints\"}");
}
}  // namespace myroboview
