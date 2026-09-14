#pragma once
#include "myroboview/core.hpp"
#include "myroboview/navigation.hpp"
namespace myroboview {
void register_api(std::shared_ptr<StateStore> store, std::shared_ptr<Navigation> nav, const std::string &share);
}
