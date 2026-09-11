cmake_minimum_required(VERSION 3.15)

project(roboview)
# ament_cmake 是ROS2的构建系统
find_package(ament_cmake REQUIRED)

# 产品由顶层 Makefile 传入：-DAI_TARGET_PRODUCT=lrs-x|lrd-w
if(NOT DEFINED AI_TARGET_PRODUCT OR AI_TARGET_PRODUCT STREQUAL "")
    set(AI_TARGET_PRODUCT "lrs-x")
    message(WARNING "[roboview] AI_TARGET_PRODUCT 未设置，默认使用 lrs-x")
endif()
# 添加宏编译定义
if(AI_TARGET_PRODUCT STREQUAL "lrs-x")
    add_compile_definitions(PRODUCT_LRS_X)
elseif(AI_TARGET_PRODUCT STREQUAL "lrd-w")
    add_compile_definitions(PRODUCT_LRD_W)
endif()

# if(AI_TARGET_PLATFORM STREQUAL "nx")
    set(CMAKE_CXX_STANDARD 17)
    set(CMAKE_CXX_STANDARD_REQUIRED ON)

    # find_package(Drogon CONFIG REQUIRED)
    # find_package(jsoncpp REQUIRED)

    # 包含目录
    include_directories(
        ${CMAKE_CURRENT_SOURCE_DIR}/backend/include
        ${CMAKE_INSTALL_PREFIX}/include
        ${CMAKE_INSTALL_PREFIX}/include/lyos_msgs
        )

    # x86_64平台的jsoncpp需要包含/jsoncpp/头文件路径
    if (AI_TARGET_PLATFORM STREQUAL "x86_64")
        include_directories(
            /usr/include/jsoncpp
        )
    endif()

    # 源文件
    set(SOURCES
        backend/src/main.cpp
        backend/src/websocket_handler.cpp
        backend/src/api_handlers.cpp
        backend/src/auth_service.cpp
        backend/src/lyos_subscriber.cpp
        backend/src/lyos_data_provider.cpp
        backend/src/view_config.cpp
        backend/src/nav_manager.cpp
        backend/src/nav_map_io.cpp
    )
    # 前端构建：注入 REACT_APP_PRODUCT（与 AI_TARGET_PRODUCT 一致），选中对应 robotUrdfConfig
    # URDF 大资源不经 npm，由下方 install 从 assets 直装到 etc/web/robot_urdf/
    add_custom_target(frontend_build
        rsync -avz  /opt/npm/node_modules ${CMAKE_CURRENT_SOURCE_DIR}/my-app/
        COMMAND ${CMAKE_COMMAND} -E env
            REACT_APP_PRODUCT=${AI_TARGET_PRODUCT}
            npm run build
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/my-app
    )

    # 可执行文件
    add_executable(${PROJECT_NAME} ${SOURCES})
    add_dependencies(${PROJECT_NAME} frontend_build)
    target_link_directories(${PROJECT_NAME} PUBLIC
    ${CMAKE_INSTALL_PREFIX}/lib
    )

    # 抑制第三方库（yaml-cpp）的弃用警告
    # yaml-cpp 使用了已弃用的 std::iterator，这是库的问题，不是我们的代码问题
    if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU" OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
        target_compile_options(${PROJECT_NAME} PRIVATE -Wno-deprecated-declarations)
    endif()

    find_package(OpenSSL REQUIRED)

    target_link_libraries(${PROJECT_NAME}
        PRIVATE
        drogon
        trantor
        jsoncpp
        lyoslib
        robot_ai_common
        OpenSSL::Crypto
    )

    # 安装规则
    install(TARGETS ${PROJECT_NAME}
        RUNTIME DESTINATION bin
    )

    # 安装前端构建产物 build 目录中所有内容(JS/CSS/HTML)(排除robot_urdf目录) 到 etc/web/ 
    # 安装 assets下对应产品的所有目录(robot_urdf资源目录等) 到 etc/web/
    set(WEB_DIR 
        ${CMAKE_CURRENT_SOURCE_DIR}/my-app/build/)
    set(ROBOT_URDF_DIR 
        ${CMAKE_CURRENT_SOURCE_DIR}/my-app/assets/${AI_TARGET_PRODUCT}/)
    install(DIRECTORY ${WEB_DIR}
        DESTINATION etc/web/
        PATTERN "robot_urdf" EXCLUDE
    )
    install(DIRECTORY ${ROBOT_URDF_DIR}
        DESTINATION etc/web/
    )

    # 安装登陆认证配置(密钥一致) + 产品对应的 roboview.yaml 到 etc/web_config/
    set(AUTH_USERS_JSON
        ${CMAKE_CURRENT_SOURCE_DIR}/backend/config/auth/auth_users.json)
    set(ROBOVIEW_YAML
        ${CMAKE_CURRENT_SOURCE_DIR}/backend/config/${AI_TARGET_PRODUCT}/roboview.yaml)
    install(FILES
        ${AUTH_USERS_JSON}
        ${ROBOVIEW_YAML}
        DESTINATION etc/web_config/
    )
# endif()
ament_package()
