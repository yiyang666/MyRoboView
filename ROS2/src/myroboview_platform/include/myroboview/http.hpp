#pragma once
#include "myroboview/core.hpp"
#include <boost/asio.hpp>

namespace myroboview {
class HttpServer {
 public:
  HttpServer(boost::asio::io_context &io, const Json::Value &cfg, std::shared_ptr<StateStore> store, std::string web_root);
 private:
  void accept();
  boost::asio::ip::tcp::acceptor acceptor_;
  std::shared_ptr<StateStore> store_;
  std::shared_ptr<const std::map<std::string, std::pair<std::string, std::string>>> assets_;
};
}  // namespace myroboview
