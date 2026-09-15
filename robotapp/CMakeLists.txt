cmake_minimum_required(VERSION 3.16)
project(robotapp)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(ament_index_cpp REQUIRED)
find_package(node_app_msgs REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(jsoncpp CONFIG REQUIRED)

# 产品标识：由外层统一构建体系传入（与 roboview 对齐），仓内直编时默认 lrs-x
if(NOT AI_TARGET_PRODUCT)
    set(AI_TARGET_PRODUCT lrs-x)
endif()

add_executable(robotapp_node
    src/main.cpp
)
target_include_directories(robotapp_node PRIVATE
    include
)
ament_target_dependencies(robotapp_node
    rclcpp
    ament_index_cpp
    node_app_msgs
    sensor_msgs
)
target_link_libraries(robotapp_node
    jsoncpp_lib
)
target_compile_options(robotapp_node PRIVATE
    -Wall
    -Wextra
    -Wpedantic
)

# 单元测试
if(BUILD_TESTING)
    enable_testing()
    add_executable(state_machine_test
        test/state_machine_test.cpp
    )
    target_include_directories(state_machine_test PRIVATE
        include
    )
    ament_target_dependencies(state_machine_test
        node_app_msgs
    )
    add_test(NAME robotapp_state_machine
        COMMAND state_machine_test
    )
endif()

# ------------------------------------------------------------
# 安装规则
# 布局与原项目对齐：二进制进 bin/，配置进 etc/robotapp/
# ------------------------------------------------------------
install(TARGETS robotapp_node
    RUNTIME DESTINATION bin
)

# mock 配置按产品拆分（config/<产品>/），只安装当前产品那一份为默认配置
# configure 期校验存在性，避免安装期才失败
set(ROBOTAPP_CONFIG
    ${CMAKE_CURRENT_SOURCE_DIR}/config/${AI_TARGET_PRODUCT}/robotapp.json)
if(NOT EXISTS ${ROBOTAPP_CONFIG})
    message(FATAL_ERROR "缺少产品 ${AI_TARGET_PRODUCT} 的 robotapp 配置: config/${AI_TARGET_PRODUCT}/robotapp.json")
endif()
install(FILES ${ROBOTAPP_CONFIG}
    DESTINATION etc/robotapp
)

ament_package()
