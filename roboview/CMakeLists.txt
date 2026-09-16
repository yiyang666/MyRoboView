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
            # 导航夹具随目录重构迁到 config/<产品>/ 下（原 backend/assets/navigation.json 已不存在）
            ${CMAKE_CURRENT_SOURCE_DIR}/backend/config/${AI_TARGET_PRODUCT}/navigation.json
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
# 构建层：REACT_APP_PRODUCT 注入当前产品（电机卡片等按产品差异化）
# 输出目录由 vite.config.js 按 REACT_APP_PRODUCT 决定（build/<产品>）：双产品交替构建互不覆盖，install 不会误装对方产物
# 注意：Vite 构建不再内置 ESLint 检查（原 CRA 行为），源码质量问题走编辑器/评审把关
add_custom_command(
    OUTPUT ${CMAKE_CURRENT_SOURCE_DIR}/frontend/build/${AI_TARGET_PRODUCT}/index.html
    COMMAND ${CMAKE_COMMAND} -E env
        REACT_APP_PRODUCT=${AI_TARGET_PRODUCT}
        npm run build
    DEPENDS
        ${CMAKE_CURRENT_BINARY_DIR}/.npm_stamp
        ${CMAKE_CURRENT_SOURCE_DIR}/frontend/index.html
        ${CMAKE_CURRENT_SOURCE_DIR}/frontend/vite.config.js
        ${FRONTEND_SOURCES}
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/frontend
)
add_custom_target(frontend_build ALL
    DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/frontend/build/${AI_TARGET_PRODUCT}/index.html
)

# ------------------------------------------------------------
# 安装规则
# 按产品（${AI_TARGET_PRODUCT}）拆分，只安装当前产品那一份
# 布局与原项目对齐：二进制进 bin/，配置文件进 etc/web_config/，前后端静态页和资源进 etc/web/
# ------------------------------------------------------------
install(TARGETS roboview
    RUNTIME DESTINATION bin
)

# 项目配置文件 → etc/web_config/
## 第一步：configure 期校验存在性，避免安装期才失败
set(BACKEND_CONFIG_DIR
    ${CMAKE_CURRENT_SOURCE_DIR}/backend/config/${AI_TARGET_PRODUCT})
set(BACKEND_AUTH_DIR
    ${CMAKE_CURRENT_SOURCE_DIR}/backend/config/auth)
set(BACKEND_ASSETS_MAPS_DIR
    ${CMAKE_CURRENT_SOURCE_DIR}/backend/assets/${AI_TARGET_PRODUCT}/maps)
file(GLOB BACKEND_CONFIG_FILES "${BACKEND_CONFIG_DIR}/*.json")
file(GLOB BACKEND_AUTH_FILES "${BACKEND_AUTH_DIR}/*.json")
file(GLOB BACKEND_ASSETS_MAPS_FILES "${BACKEND_ASSETS_MAPS_DIR}/*.png")
if(NOT BACKEND_CONFIG_FILES OR NOT BACKEND_AUTH_FILES OR NOT BACKEND_ASSETS_MAPS_FILES)
    message(FATAL_ERROR "缺少产品 ${AI_TARGET_PRODUCT} 的后端配置文件或资源文件!!!")
endif()
## 第二步：安装配置文件进 etc/web_config/
install(FILES
    ${BACKEND_CONFIG_FILES}
    ${BACKEND_AUTH_FILES}
    DESTINATION etc/web_config
)

# 项目npm 产物与网页静态资源 → etc/web/和 etc/web/assets/
# 安装前整目录清空 etc/web，避免异产品资源残留；清空须在地图/页面/URDF 安装之前，否则刚装上的内容会被删掉。
install(CODE [[
    set(web_root "$ENV{DESTDIR}${CMAKE_INSTALL_PREFIX}/etc/web")
    if(IS_SYMLINK "${web_root}")
        file(REMOVE "${web_root}")
    elseif(EXISTS "${web_root}")
        file(REMOVE_RECURSE "${web_root}")
    endif()
]])
## 第三步：安装地图等资源文件进 etc/web/assets/
install(DIRECTORY ${BACKEND_ASSETS_MAPS_DIR}/
    DESTINATION etc/web/assets/maps
)
## 第四步：根据产品目录安装新的前端产物到 etc/web/， 除了 robot_urdf 目录
## （开发态同步进 public/ 后被构建原样拷贝，具有产品不确定性），其余都安装
install(DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/frontend/build/${AI_TARGET_PRODUCT}/
    DESTINATION etc/web
    PATTERN "robot_urdf" EXCLUDE
)
## 第五步：单独安装前端 robot_urdf等资源到 etc/web/assets/
set(ROBOT_FRONTEND_ASSERTS_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/frontend/asserts/${AI_TARGET_PRODUCT}")
file(GLOB ROBOT_FRONTEND_ASSERTS_ITEMS
    "${ROBOT_FRONTEND_ASSERTS_DIR}/*")
if(ROBOT_FRONTEND_ASSERTS_ITEMS)
    install(DIRECTORY ${ROBOT_FRONTEND_ASSERTS_DIR}/
        DESTINATION etc/web/assets
    )
else()
    message(WARNING "产品 ${AI_TARGET_PRODUCT} 无 frontend/asserts 资源!!!跳过安装!!!")
endif()

ament_package()
