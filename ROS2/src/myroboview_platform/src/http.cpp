#include "myroboview/http.hpp"
#include <boost/beast.hpp>
#include <fstream>
#include <sstream>

namespace myroboview {
namespace {
namespace beast = boost::beast;
namespace http = beast::http;
using tcp = boost::asio::ip::tcp;
using Assets = std::map<std::string, std::pair<std::string, std::string>>;
class Session : public std::enable_shared_from_this<Session> {
 public:
  Session(tcp::socket socket, std::shared_ptr<StateStore> store, std::shared_ptr<const Assets> assets)
      : stream_(std::move(socket)), store_(std::move(store)), assets_(std::move(assets)) {}
  void start() {
    parser_.body_limit(1024); parser_.header_limit(8192);
    stream_.expires_after(std::chrono::seconds(5));
    http::async_read(stream_, buffer_, parser_, [self = shared_from_this()](beast::error_code ec, std::size_t) {
      if (!ec) self->respond();
    });
  }
 private:
  void respond() {
    const auto &request = parser_.get();
    auto target = std::string(request.target()); target = target.substr(0, target.find('?'));
    response_.version(11); response_.keep_alive(false);
    response_.set(http::field::content_type, "application/json; charset=utf-8");
    response_.set(http::field::cache_control, "no-store");
    response_.set("X-Content-Type-Options", "nosniff");
    response_.set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
    if (request.method() != http::verb::get) {
      response_.result(http::status::method_not_allowed); response_.set(http::field::allow, "GET"); response_.body() = "{\"error\":\"read_only\"}";
    } else if (target == "/api/v1/state") {
      response_.result(http::status::ok); response_.body() = encode(store_->snapshot());
    } else if (target == "/api/v1/health") {
      response_.result(http::status::ok); response_.body() = "{\"status\":\"ok\",\"service\":\"myroboview\",\"read_only\":true}";
    } else if (assets_->count(target)) {
      response_.result(http::status::ok); const auto &asset = assets_->at(target);
      response_.set(http::field::content_type, asset.first); response_.body() = asset.second;
    } else {
      response_.result(http::status::not_found); response_.body() = "{\"error\":\"not_found\"}";
    }
    response_.prepare_payload(); stream_.expires_after(std::chrono::seconds(5));
    http::async_write(stream_, response_, [self = shared_from_this()](beast::error_code, std::size_t) {
      beast::error_code ignored; self->stream_.socket().shutdown(tcp::socket::shutdown_both, ignored);
    });
  }
  beast::tcp_stream stream_;
  beast::flat_buffer buffer_;
  http::request_parser<http::string_body> parser_;
  http::response<http::string_body> response_;
  std::shared_ptr<StateStore> store_;
  std::shared_ptr<const Assets> assets_;
};
}
HttpServer::HttpServer(boost::asio::io_context &io, const Json::Value &cfg, std::shared_ptr<StateStore> store, std::string root)
    : acceptor_(io), store_(std::move(store)) {
  auto assets = std::make_shared<Assets>();
  for (const auto &entry : std::vector<std::tuple<std::string, std::string, std::string>>{
      {"/", "index.html", "text/html; charset=utf-8"}}) {
    std::ifstream file(root + "/" + std::get<1>(entry));
    if (!file) throw std::runtime_error("Cannot read web asset: " + std::get<1>(entry));
    std::ostringstream body; body << file.rdbuf();
    assets->emplace(std::get<0>(entry), std::make_pair(std::get<2>(entry), body.str()));
  }
  assets_ = assets;
  tcp::endpoint endpoint(boost::asio::ip::make_address(cfg["server"]["host"].asString()), cfg["server"]["port"].asUInt());
  acceptor_.open(endpoint.protocol()); acceptor_.set_option(tcp::acceptor::reuse_address(true));
  acceptor_.bind(endpoint); acceptor_.listen(32); accept();
}
void HttpServer::accept() {
  acceptor_.async_accept([this](boost::system::error_code ec, tcp::socket socket) {
    if (!ec) std::make_shared<Session>(std::move(socket), store_, assets_)->start();
    if (acceptor_.is_open()) accept();
  });
}
}  // namespace myroboview
