#include "myroboview/ros_subscriber.hpp"
#include "myroboview/introspection.hpp"
namespace myroboview {
RosSubscriber::RosSubscriber(const Json::Value &config,
                             std::shared_ptr<StateStore> store)
    : Node("myroboview_server") {
    for (const auto &spec : config["topics"]) {
        const auto id = spec["id"].asString();
        auto decoder = std::make_shared<Decoder>(spec["type"].asString());
        subscriptions_.push_back(create_generic_subscription(
            spec["topic"].asString(), spec["type"].asString(), qos(spec),
            [decoder, store,
             id](std::shared_ptr<rclcpp::SerializedMessage> message) {
                try {
                    store->update(id, decoder->decode(*message));
                } catch (const std::exception &error) {
                    store->reject(id, error.what());
                }
            }));
    }
}
}  // namespace myroboview
