cmake_minimum_required(VERSION 3.16)
# 包根位于 roboview/（前后端同级，与原项目对齐），一次构建内完成前后端产物对齐
project(roboview)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(ament_index_cpp REQUIRED)
find_package(rosidl_typesupport_introspection_cpp REQUIRED)
find_package(Drogon CONFIG REQUIRED)
find_package(node_app_msgs REQUIRED)

# 产品标识：由外层统一构建体系传入（-DAI_TARGET_PRODUCT=lrs-x|lrd-w），仓内直编时默认 lrs-x
# 后端配置与前端 URDF 资源均按它对齐
if(NOT AI_TARGET_PRODUCT)
    set(AI_TARGET_PRODUCT lrs-x)
endif()

# 后端核心库
add_library(backend_core
    backend/src/config.cpp
    backend/src/state.cpp
    backend/src/introspection.cpp
    backend/src/navigation.cpp
)
target_include_directories(backend_core PUBLIC
    backend/include
)
ament_target_dependencies(backend_core
    rclcpp
    ament_index_cpp
    rosidl_typesupport_introspection_cpp
)
target_link_libraries(backend_core
    Drogon::Drogon
)

# 后端可执行文件
add_executable(roboview
    backend/src/main.cpp
    backend/src/ros_subscriber.cpp
    backend/src/command_publisher.cpp
    backend/src/api.cpp
    backend/src/websocket.cpp
)
ament_target_dependencies(roboview
    rclcpp
    ament_index_cpp
    node_app_msgs
)
target_link_libraries(roboview
    backend_core
)

foreach(target backend_core roboview)
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic)
endforeach()

# 单元测试
if(BUILD_TESTING)
    enable_testing()
    find_package(node_app_msgs REQUIRED)
    find_package(sensor_msgs REQUIRED)
    add_executable(core_test
        backend/test/core_test.cpp
    )
    ament_target_dependencies(core_test
        node_app_msgs
        sensor_msgs
    )
    target_link_libraries(core_test
        backend_core
    )
    add_test(NAME core_test
        COMMAND core_test
            ${CMAKE_CURRENT_SOURCE_DIR}/backend/config/${AI_TARGET_PRODUCT}/myroboview.json
            ${CMAKE_CURRENT_SOURCE_DIR}/backend/assets/navigation.json
    )
endif()

# 前端构建：lock 变化才 npm ci，源码变化才重打包；CI 全新工作区必然全量构建
file(GLOB_RECURSE FRONTEND_SOURCES CONFIGURE_DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/frontend/src/*
    ${CMAKE_CURRENT_SOURCE_DIR}/frontend/public/*
)
# 依赖层：stamp 记录在构建目录，不污染源码树
add_custom_command(
    OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/.npm_stamp
    COMMAND npm ci --prefer-offline --no-audit --no-fund
    COMMAND ${CMAKE_COMMAND} -E touch ${CMAKE_CURRENT_BINARY_DIR}/.npm_stamp
    DEPENDS
        ${CMAKE_CURRENT_SOURCE_DIR}/frontend/package.json
        ${CMAKE_CURRENT_SOURCE_DIR}/frontend/package-lock.json
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/frontend
)
# 构建层：CI=true 让 CRA 把 warning 当错误，保证入包代码干净
add_custom_command(
    OUTPUT ${CMAKE_CURRENT_SOURCE_DIR}/frontend/build/index.html
    COMMAND ${CMAKE_COMMAND} -E env
        CI=true
        npm run build
    DEPENDS
        ${CMAKE_CURRENT_BINARY_DIR}/.npm_stamp
        ${FRONTEND_SOURCES}
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/frontend
)
add_custom_target(frontend_build ALL
    DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/frontend/build/index.html
)

# ------------------------------------------------------------
# 安装规则
# 布局与原项目对齐：二进制进 bin/，配置与导航数据进 etc/web_config/，前端静态页进 etc/web/
# ------------------------------------------------------------
install(TARGETS roboview
    RUNTIME DESTINATION bin
)

# 后端配置按产品拆分（backend/config/<产品>/），只安装当前产品那一份
# configure 期校验存在性，避免安装期才失败
set(BACKEND_CONFIG
    ${CMAKE_CURRENT_SOURCE_DIR}/backend/config/${AI_TARGET_PRODUCT}/myroboview.json)
if(NOT EXISTS ${BACKEND_CONFIG})
    message(FATAL_ERROR "缺少产品 ${AI_TARGET_PRODUCT} 的后端配置: backend/config/${AI_TARGET_PRODUCT}/myroboview.json")
endif()
install(FILES ${BACKEND_CONFIG}
    DESTINATION etc/web_config
)
install(FILES backend/assets/navigation.json
    DESTINATION etc/web_config
)

# 前端 npm 产物 → etc/web/（由 frontend_build 保证存在；robot_urdf 不经 npm，由下方 asserts 规则直装）
install(DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/frontend/build/
    DESTINATION etc/web
    PATTERN "robot_urdf" EXCLUDE
)

set(ROBOT_ASSERTS
    ${CMAKE_CURRENT_SOURCE_DIR}/frontend/asserts/${AI_TARGET_PRODUCT})
if(EXISTS ${ROBOT_ASSERTS}/robot_urdf)
    install(DIRECTORY ${ROBOT_ASSERTS}/
        DESTINATION etc/web
    )
else()
    message(WARNING "产品 ${AI_TARGET_PRODUCT} 无 frontend/asserts 资源，跳过 URDF 安装")
endif()

# 地图等 Web 资源并入 etc/web/assets/
install(FILES backend/assets/test_map01.png
    DESTINATION etc/web/assets
)

ament_package()
