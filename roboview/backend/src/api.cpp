#include "roboview/api.hpp"
#include <drogon/drogon.h>
#include <fstream>
#include <sstream>

namespace roboview {
namespace {
using Callback = std::function<void(const drogon::HttpResponsePtr &)>;
Json::Value body(const drogon::HttpRequestPtr &req) {
    auto value = req->getJsonObject();
    if (!value || !value->isObject())
        throw NavError(400, "Expected a JSON object");
    return *value;
}
void reply(Callback &callback, const std::function<Json::Value()> &action) {
    try {
        callback(drogon::HttpResponse::newHttpJsonResponse(action()));
    } catch (const NavError &error) {
        Json::Value v;
        v["success"] = false;
        v["error"] = error.what();
        auto response = drogon::HttpResponse::newHttpJsonResponse(v);
        response->setStatusCode(
            static_cast<drogon::HttpStatusCode>(error.code));
        callback(response);
    } catch (const std::exception &) {
        auto response = drogon::HttpResponse::newHttpJsonResponse(
            Json::Value("Internal demo error"));
        response->setStatusCode(drogon::k500InternalServerError);
        callback(response);
    }
}
}  // namespace
void register_api(std::shared_ptr<StateStore> store,
                  std::shared_ptr<Navigation> nav,
                  const std::string &web_root) {
    auto &app = drogon::app();
    app.registerPostHandlingAdvice([](const auto &, const auto &response) {
        response->addHeader("Cache-Control", "no-store");
        response->addHeader("X-Content-Type-Options", "nosniff");
    });
    app.registerHandler("/api/v1/health",
                        [nav](const drogon::HttpRequestPtr &, Callback &&cb) {
                            Json::Value v;
                            v["status"] = "ok";
                            v["framework"] = "drogon";
                            v["robot_control"] = bool(nav);
                            v["navigation_demo"] = bool(nav);
                            cb(drogon::HttpResponse::newHttpJsonResponse(v));
                        },
                        {drogon::Get});
    app.registerHandler(
        "/api/v1/state",
        [store](const drogon::HttpRequestPtr &, Callback &&cb) {
            cb(drogon::HttpResponse::newHttpJsonResponse(store->snapshot()));
        },
        {drogon::Get});
    // Only explicit bundled assets are served; no arbitrary machine-path
    // browsing.
    for (const auto &asset :
         std::vector<std::tuple<std::string, std::string, std::string>>{
             {"/", "index.html", "text/html; charset=utf-8"},
             {"/nav_maps/test_map01.png", "assets/test_map01.png",
              "image/png"}}) {
        std::ifstream f(web_root + "/" + std::get<1>(asset), std::ios::binary);
        if (!f) throw std::runtime_error("Missing bundled asset");
        std::ostringstream data;
        data << f.rdbuf();
        app.registerHandler(std::get<0>(asset),
                            [payload = data.str(), type = std::get<2>(asset)](
                                const drogon::HttpRequestPtr &, Callback &&cb) {
                                auto response =
                                    drogon::HttpResponse::newHttpResponse();
                                response->setContentTypeString(type);
                                response->setBody(payload);
                                cb(response);
                            },
                            {drogon::Get});
    }
    if (!nav) return;
    app.registerHandler(
        "/api/v1/nav/mapping/start",
        [nav](const drogon::HttpRequestPtr &req, Callback &&cb) {
            reply(cb, [&] { return nav->mapping_start(body(req)); });
        },
        {drogon::Post});
    app.registerHandler("/api/v1/nav/mapping/stop",
                        [nav](const drogon::HttpRequestPtr &, Callback &&cb) {
                            reply(cb, [&] { return nav->mapping_stop(); });
                        },
                        {drogon::Post});
    app.registerHandler(
        "/api/v1/nav/localization/start",
        [nav](const drogon::HttpRequestPtr &, Callback &&cb) {
            reply(cb, [&] { return nav->localize(Json::Value(), false); });
        },
        {drogon::Post});
    app.registerHandler(
        "/api/v1/nav/localization/manual",
        [nav](const drogon::HttpRequestPtr &req, Callback &&cb) {
            reply(cb, [&] { return nav->localize(body(req), true); });
        },
        {drogon::Post});
    app.registerHandler("/api/v1/nav/maps",
                        [nav](const drogon::HttpRequestPtr &, Callback &&cb) {
                            reply(cb, [&] { return nav->maps(); });
                        },
                        {drogon::Get});
    app.registerHandler("/api/v1/nav/maps/current/resources",
                        [nav](const drogon::HttpRequestPtr &, Callback &&cb) {
                            reply(cb, [&] { return nav->resources(); });
                        },
                        {drogon::Get});
    app.registerHandler("/api/v1/nav/state",
                        [nav](const drogon::HttpRequestPtr &, Callback &&cb) {
                            reply(cb, [&] { return nav->snapshot(); });
                        },
                        {drogon::Get});
    app.registerHandler(
        "/api/v1/nav/maps/load",
        [nav](const drogon::HttpRequestPtr &req, Callback &&cb) {
            reply(cb, [&] { return nav->load_map(body(req)); });
        },
        {drogon::Post});
    app.registerHandler(
        "/api/v1/nav/waypoints",
        [nav](const drogon::HttpRequestPtr &req, Callback &&cb) {
            reply(cb, [&] { return nav->add_waypoint(body(req)); });
        },
        {drogon::Post});
    app.registerHandler(
        "/api/v1/nav/waypoints/{1}",
        [nav](const drogon::HttpRequestPtr &, Callback &&cb, std::string id) {
            reply(cb, [&] { return nav->delete_waypoint(id); });
        },
        {drogon::Delete});
    app.registerHandler(
        "/api/v1/nav/routes",
        [nav](const drogon::HttpRequestPtr &req, Callback &&cb) {
            reply(cb, [&] { return nav->add_route(body(req)); });
        },
        {drogon::Post});
    app.registerHandler(
        "/api/v1/nav/routes/{1}",
        [nav](const drogon::HttpRequestPtr &, Callback &&cb, std::string id) {
            reply(cb, [&] { return nav->delete_route(id); });
        },
        {drogon::Delete});
    app.registerHandler(
        "/api/v1/nav/tasks/route/start",
        [nav](const drogon::HttpRequestPtr &req, Callback &&cb) {
            reply(cb, [&] { return nav->start(body(req)); });
        },
        {drogon::Post});
    app.registerHandler("/api/v1/nav/tasks/route/pause",
                        [nav](const drogon::HttpRequestPtr &, Callback &&cb) {
                            reply(cb, [&] { return nav->pause(); });
                        },
                        {drogon::Post});
    app.registerHandler("/api/v1/nav/tasks/route/resume",
                        [nav](const drogon::HttpRequestPtr &, Callback &&cb) {
                            reply(cb, [&] { return nav->resume(); });
                        },
                        {drogon::Post});
    app.registerHandler("/api/v1/nav/tasks/route/stop",
                        [nav](const drogon::HttpRequestPtr &, Callback &&cb) {
                            reply(cb, [&] { return nav->stop(); });
                        },
                        {drogon::Post});
}
}  // namespace roboview
