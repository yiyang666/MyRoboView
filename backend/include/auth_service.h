/*
 * 基于 JSON 配置文件的固定账号认证（PBKDF2-SHA256 密码哈希 + HS256 JWT）。
 */
#pragma once

#include <drogon/HttpRequest.h>
#include <json/json.h>
#include <optional>
#include <string>
#include <vector>

namespace robot_monitor {

struct AuthUserEntry {
    std::string username;
    std::string role;  // admin | developer | user
    std::string password_pbkdf2;  // pbkdf2-sha256$iter$salt_hex$hash_hex
};

struct AuthClaims {
    std::string username;
    std::string role;
};

class AuthService {
 public:
    static AuthService& instance();

    /** 从 JSON 文件加载 jwt_secret 与 users；失败返回 false。 */
    bool loadFromFile(const std::string& path);

    bool isLoaded() const { return loaded_; }

    /** 校验用户名密码，成功则写入 JWT（HS256）与角色。 */
    bool issueToken(const std::string& username, const std::string& password,
                    std::string& out_jwt, int64_t& out_exp_unix,
                    std::string& out_role) const;

    bool verifyJwt(const std::string& jwt, AuthClaims& out) const;

    /** 从 Authorization: Bearer 解析并校验 JWT。 */
    bool parseBearer(const drogon::HttpRequestPtr& req, AuthClaims& out) const;

    /** 角色等级：admin > developer > user。 */
    static int roleRank(const std::string& role);

    /** 若 actor 等级 >= minRole 对应等级则通过。 */
    static bool roleAtLeast(const std::string& actor_role,
                            const std::string& min_role);

 private:
    AuthService() = default;

    bool verify_pbkdf2(const std::string& encoded,
                       const std::string& password) const;

    std::string jwt_secret_;
    std::vector<AuthUserEntry> users_;
    bool loaded_{false};
};

}  // namespace robot_monitor
