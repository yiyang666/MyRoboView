#pragma once
#include "roboview/core.hpp"
#include "roboview/navigation.hpp"
namespace roboview {
void register_api(std::shared_ptr<StateStore> store,
                  std::shared_ptr<Navigation> nav, const std::string &web_root);
}
