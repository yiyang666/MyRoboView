/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-01-23 19:28:59
 * @LastEditors: ethan.young Ethan.Yang2@lingyiitech.com
 * @LastEditTime: 2026-09-10 10:42:05
 * @FilePath: /build_all/src/roboview/backend/src/main.cpp
 * @Description: 后端入口文件
 */
#include <drogon/drogon.h>
#include <robot_ai_common/base/utils.h>
#include "api_handlers.h"
#include "auth_service.h"
#include "websocket_handler.h"
#include "robot_state.h"
#include "lyos_subscriber.h"
#include "lyos_data_provider.h"
#include "view_config.h"
#include <lyos/lyos.h>
#include <iostream>
#include <signal.h>
#include <unistd.h>
#include <cstdlib>
#include <string>

using namespace drogon;
using namespace robot_monitor;

// NX（默认）：/app/bin/roboview ，配置 /app/etc/web_config/
// x86 开发：由 start_dev.sh 设置 ROBOVIEW_* 环境变量指向 install 目录
#define ETC_PREFIX "/app/etc"
#define AUTH_CFG "web_config/auth_users.json"
#define VIEW_CFG "web_config/roboview.yaml"
#define UPLOAD_DIR "web_uploads"

namespace {

const char* envNonEmpty(const char* name) {
    const char* v = std::getenv(name);
    return (v && v[0]) ? v : nullptr;
}

std::string etcPath(const char* rel) {
    return std::string(ETC_PREFIX) + "/" + rel;
}

std::string resolveAuthConfig() {
    if (const char* e = envNonEmpty("ROBOVIEW_AUTH_CONFIG")) return e;
    return etcPath(AUTH_CFG);
}

std::string resolveViewConfig() {
    if (const char* e = envNonEmpty("ROBOVIEW_CONFIG")) return e;
    return etcPath(VIEW_CFG);
}

std::string resolveUploadPath() {
    if (const char* e = envNonEmpty("ROBOVIEW_UPLOAD_PATH")) return e;
    return etcPath(UPLOAD_DIR);
}

}  // namespace

// 全局变量用于信号处理
static bool g_running = true;
static int g_signal_count = 0;

void signalHandler(int sig) {
    g_signal_count++;
    std::cout << std::endl
              << "[Main] Received signal " << sig
              << " (count: " << g_signal_count << "), shutting down..."
              << std::endl;

    // 第一次收到信号：优雅关闭
    if (g_signal_count == 1) {
        g_running = false;
        // 停止 Drogon 应用
        app().quit();
    } else {
        // 多次收到信号：强制退出
        std::cout << "[Main] Force exit after multiple signals" << std::endl;
        std::exit(1);
    }
}

int main() {
    // 注册信号处理函数
    signal(SIGINT, signalHandler);   // Ctrl+C
    signal(SIGTERM, signalHandler);  // kill 命令
    std::cout << "========================================" << std::endl;
    std::cout << "  机器人监控系统 - C++ 后端服务" << std::endl;
    std::cout << "  使用 Drogon 框架" << std::endl;
    std::cout << "========================================" << std::endl;

    // 设置日志级别
    trantor::Logger::setLogLevel(trantor::Logger::kInfo);
    ai_common::base::setRobotEtcPath(ETC_PREFIX);

    app().registerPostHandlingAdvice(
        [](const HttpRequestPtr& /*req*/, const HttpResponsePtr& resp) {
            resp->addHeader("Access-Control-Allow-Origin", "*");
            resp->addHeader("Access-Control-Allow-Methods",
                            "GET,POST,PUT,DELETE,OPTIONS");
            resp->addHeader("Access-Control-Allow-Headers",
                            "Origin,Content-Type,Accept,Authorization");
        });

    // 设置服务器配置：地图编辑 PUT 可能上传数 MB 级 PGM
    app().setClientMaxBodySize(5 * 1024 * 1024);  // 5MB

    const std::string upload_path = resolveUploadPath();
    app().setUploadPath(upload_path);
    std::cout << "[Main] Upload path: " << upload_path << std::endl;

    const std::string auth_cfg = resolveAuthConfig();
    std::cout << "[Main] auth_cfg: " << auth_cfg << std::endl;
    if (!AuthService::instance().loadFromFile(auth_cfg)) {
        std::cerr << "[Main] FATAL: cannot load auth config: " << auth_cfg
                  << std::endl;
        std::cerr << "[Main] 部署端确保 /app/etc/web_config/auth_users.json 存在; "
                     "x86端请使用 start_dev.sh 启动"
                  << std::endl;
        std::exit(1);
    }

    const std::string view_cfg = resolveViewConfig();
    std::cout << "[Main] view_cfg: " << view_cfg << std::endl;
    if (!ViewConfigManager::getInstance().loadFromFile(view_cfg)) {
        std::cerr << "[Main] WARNING: cannot load roboview config: " << view_cfg
                  << ", using defaults" << std::endl;
    }
    // 按产品 motor_count 建立关节空槽，供后续 motor_health 按 index 更新
    {
        const auto motor_count =
            ViewConfigManager::getInstance().getConfig().motor_count;
        RobotStateManager::getInstance().initJoints(motor_count);
        std::cout << "[Main] initJoints count=" << motor_count << std::endl;
    }

    std::cout << "========================================" << std::endl;
    std::cout << "机器人监控后端服务启动" << std::endl;
    std::cout << "========================================" << std::endl;
    std::cout << "HTTP API 地址: http://localhost:8080/api/v1" << std::endl;
    std::cout << "WebSocket 地址: ws://localhost:8080/ws" << std::endl;
    std::cout << "========================================" << std::endl;

    // 初始化 lyos
    std::cout << "[Main] Initializing Lyos..." << std::endl;
    lyos::init("roboview");

    // 初始化并启动 Lyos 订阅器（处理话题订阅类数据）
    std::cout << "[Main] Starting Lyos topic subscriber..." << std::endl;
    LyosSubscriber lyos_subscriber;
    if (!lyos_subscriber.init()) {
        std::cerr << "[Main] WARNING: Failed to initialize Lyos subscriber, "
                     "robot status will not be available"
                  << std::endl;
    }

    // 启动 LyosDataProvider（处理主动获取类数据，例如共享内存日志）
    std::cout << "[Main] Starting Lyos data provider (SHM logs)..."
              << std::endl;
    LyosDataProvider::instance().start();

    // 注意：状态广播改为在收到 Lyos 消息时直接广播，不再使用定时器
    // 接收数据超时检测由前端处理

    // 启动服务器
    app().setLogLevel(trantor::Logger::kWarn);
    app().addListener("0.0.0.0", 8080);
    std::cout << "[Main] Server listening on 0.0.0.0:8080" << std::endl;
    std::cout << "[Main] Ready to accept connections" << std::endl;

    // 运行服务器（阻塞直到收到退出信号）
    app().run();

    // 优雅关闭：停止所有后台线程和服务
    std::cout << "[Main] Shutting down services..." << std::endl;

    std::cout << "[Main] Stopping LyosDataProvider..." << std::endl;
    LyosDataProvider::instance().stop();

    // 先停回调，再 shutdown lyos，最后 join 并析构订阅对象
    std::cout << "[Main] Disabling Lyos topic callbacks..." << std::endl;
    lyos_subscriber.disableSubscriptions();

    std::cout << "[Main] Stopping Lyos (this will interrupt spin threads)..."
              << std::endl;
    lyos::shutdown();

    std::cout << "[Main] Stopping LyosSubscriber..." << std::endl;
    lyos_subscriber.shutdown();

    std::cout << "[Main] Shutdown complete" << std::endl;
    return 0;
}
