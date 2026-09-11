#include "auth_service.h"

#include <drogon/drogon.h>
#include <json/json.h>

#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/sha.h>

#include <chrono>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <sstream>

namespace robot_monitor {

namespace {

constexpr int64_t kJwtTtlSeconds = 12 * 3600;

std::string readAll(const std::string& path) {
    std::ifstream ifs(path, std::ios::binary);
    if (!ifs) return {};
    std::ostringstream oss;
    oss << ifs.rdbuf();
    return oss.str();
}

bool hexDecode(const std::string& hex, std::vector<unsigned char>& out) {
    if (hex.size() % 2 != 0) return false;
    out.clear();
    out.reserve(hex.size() / 2);
    for (size_t i = 0; i < hex.size(); i += 2) {
        unsigned int byte = 0;
        std::istringstream iss(hex.substr(i, 2));
        iss >> std::hex >> byte;
        if (iss.fail()) return false;
        out.push_back(static_cast<unsigned char>(byte));
    }
    return true;
}

std::string base64UrlEncode(const unsigned char* data, size_t len) {
    BIO* bmem = BIO_new(BIO_s_mem());
    BIO* b64 = BIO_new(BIO_f_base64());
    BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
    BIO* bio = BIO_push(b64, bmem);
    BIO_write(bio, data, static_cast<int>(len));
    BIO_flush(bio);
    BUF_MEM* bptr = nullptr;
    BIO_get_mem_ptr(bmem, &bptr);
    std::string out(bptr->data, bptr->length);
    BIO_free_all(bio);
    for (char& c : out) {
        if (c == '+')
            c = '-';
        else if (c == '/')
            c = '_';
    }
    while (!out.empty() && out.back() == '=') out.pop_back();
    return out;
}

bool base64UrlDecode(const std::string& in, std::vector<unsigned char>& out) {
    std::string s = in;
    for (auto& c : s) {
        if (c == '-')
            c = '+';
        else if (c == '_')
            c = '/';
    }
    while (s.size() % 4 != 0) s.push_back('=');

    BIO* bio = BIO_new_mem_buf(s.data(), static_cast<int>(s.size()));
    if (!bio) return false;
    BIO* b64 = BIO_new(BIO_f_base64());
    BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
    bio = BIO_push(b64, bio);
    out.resize(s.size());
    const int n = BIO_read(bio, out.data(), static_cast<int>(out.size()));
    BIO_free_all(bio);
    if (n <= 0) return false;
    out.resize(static_cast<size_t>(n));
    return true;
}

std::string hmacSha256Base64Url(const std::string& key,
                                const std::string& message) {
    unsigned char mac[EVP_MAX_MD_SIZE];
    unsigned int mac_len = 0;
    HMAC(EVP_sha256(), key.data(), static_cast<int>(key.size()),
         reinterpret_cast<const unsigned char*>(message.data()),
         message.size(), mac, &mac_len);
    return base64UrlEncode(mac, mac_len);
}

int64_t unixNow() {
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

}  // namespace

AuthService& AuthService::instance() {
    static AuthService inst;
    return inst;
}

bool AuthService::loadFromFile(const std::string& path) {
    loaded_ = false;
    users_.clear();
    jwt_secret_.clear();

    const std::string raw = readAll(path);
    if (raw.empty()) {
        std::cerr << "[Auth] Failed to read config: " << path << std::endl;
        return false;
    }

    Json::Value root;
    Json::CharReaderBuilder b;
    std::string errs;
    const std::unique_ptr<Json::CharReader> reader(b.newCharReader());
    if (!reader->parse(raw.data(), raw.data() + raw.size(), &root, &errs)) {
        std::cerr << "[Auth] JSON parse error: " << errs << std::endl;
        return false;
    }

    if (!root.isMember("jwt_secret") || !root["jwt_secret"].isString()) {
        std::cerr << "[Auth] Missing jwt_secret" << std::endl;
        return false;
    }
    jwt_secret_ = root["jwt_secret"].asString();
    if (jwt_secret_.size() < 32) {
        std::cerr << "[Auth] jwt_secret must be at least 32 characters"
                  << std::endl;
        return false;
    }

    if (!root.isMember("users") || !root["users"].isArray()) {
        std::cerr << "[Auth] Missing users array" << std::endl;
        return false;
    }
    const Json::Value& arr = root["users"];
    for (Json::ArrayIndex i = 0; i < arr.size(); ++i) {
        const Json::Value& u = arr[i];
        if (!u.isMember("username") || !u.isMember("role") ||
            !u.isMember("password_pbkdf2")) {
            std::cerr << "[Auth] user entry " << i << " incomplete" << std::endl;
            return false;
        }
        AuthUserEntry e;
        e.username = u["username"].asString();
        e.role = u["role"].asString();
        e.password_pbkdf2 = u["password_pbkdf2"].asString();
        if (e.username.empty() || e.role.empty() ||
            e.password_pbkdf2.empty()) {
            std::cerr << "[Auth] user entry " << i << " has empty field"
                      << std::endl;
            return false;
        }
        users_.push_back(std::move(e));
    }
    if (users_.empty()) {
        std::cerr << "[Auth] users array is empty" << std::endl;
        return false;
    }

    loaded_ = true;
    std::cout << "[Auth] Loaded " << users_.size()
              << " user(s) from " << path << std::endl;
    return true;
}

bool AuthService::verify_pbkdf2(const std::string& encoded,
                                const std::string& password) const {
    // pbkdf2-sha256$iter$salt_hex$hash_hex
    std::vector<std::string> parts;
    {
        std::istringstream iss(encoded);
        std::string p;
        while (std::getline(iss, p, '$')) {
            if (!p.empty()) parts.push_back(p);
        }
    }
    if (parts.size() != 4) return false;
    if (parts[0] != "pbkdf2-sha256") return false;
    int iterations = 0;
    try {
        iterations = std::stoi(parts[1]);
    } catch (...) {
        return false;
    }
    if (iterations < 10000) return false;

    std::vector<unsigned char> salt;
    std::vector<unsigned char> expect;
    if (!hexDecode(parts[2], salt) || salt.empty()) return false;
    if (!hexDecode(parts[3], expect) || expect.empty()) return false;

    std::vector<unsigned char> dk(expect.size());
    if (PKCS5_PBKDF2_HMAC(
            password.data(), static_cast<int>(password.size()), salt.data(),
            static_cast<int>(salt.size()), iterations, EVP_sha256(),
            static_cast<int>(dk.size()), dk.data()) != 1) {
        return false;
    }
    if (dk.size() != expect.size()) return false;
    return CRYPTO_memcmp(dk.data(), expect.data(), dk.size()) == 0;
}

bool AuthService::issueToken(const std::string& username,
                              const std::string& password, std::string& out_jwt,
                              int64_t& out_exp_unix, std::string& out_role) const {
    if (!loaded_) return false;
    out_role.clear();
    for (const auto& u : users_) {
        if (u.username != username) continue;
        if (!verify_pbkdf2(u.password_pbkdf2, password)) return false;

        const int64_t iat = unixNow();
        out_exp_unix = iat + kJwtTtlSeconds;
        out_role = u.role;

        Json::Value header;
        header["alg"] = "HS256";
        header["typ"] = "JWT";
        Json::Value payload;
        payload["sub"] = u.username;
        payload["role"] = u.role;
        payload["iat"] = static_cast<Json::Int64>(iat);
        payload["exp"] = static_cast<Json::Int64>(out_exp_unix);

        auto compact = [](const Json::Value& v) {
            Json::StreamWriterBuilder b;
            b["indentation"] = "";
            std::ostringstream oss;
            std::unique_ptr<Json::StreamWriter> w(b.newStreamWriter());
            w->write(v, &oss);
            return oss.str();
        };
        const std::string hjson = compact(header);
        const std::string pjson = compact(payload);
        const std::string h64 = base64UrlEncode(
            reinterpret_cast<const unsigned char*>(hjson.data()), hjson.size());
        const std::string p64 = base64UrlEncode(
            reinterpret_cast<const unsigned char*>(pjson.data()), pjson.size());
        const std::string signing_input = h64 + "." + p64;
        const std::string sig64 =
            hmacSha256Base64Url(jwt_secret_, signing_input);
        out_jwt = signing_input + "." + sig64;
        return true;
    }
    return false;
}

bool AuthService::verifyJwt(const std::string& jwt, AuthClaims& out) const {
    if (!loaded_ || jwt.empty()) return false;
    const size_t p1 = jwt.find('.');
    const size_t p2 = jwt.find('.', p1 + 1);
    if (p1 == std::string::npos || p2 == std::string::npos) return false;
    const std::string p0 = jwt.substr(0, p1);
    const std::string p1s = jwt.substr(p1 + 1, p2 - p1 - 1);
    const std::string sig = jwt.substr(p2 + 1);
    const std::string signing_input = p0 + "." + p1s;
    const std::string expect_sig =
        hmacSha256Base64Url(jwt_secret_, signing_input);
    if (sig.size() != expect_sig.size() ||
        CRYPTO_memcmp(reinterpret_cast<const unsigned char*>(sig.data()),
                      reinterpret_cast<const unsigned char*>(expect_sig.data()),
                      sig.size()) != 0) {
        return false;
    }

    std::vector<unsigned char> dec;
    if (!base64UrlDecode(p1s, dec)) return false;
    const std::string payload_json(dec.begin(), dec.end());

    Json::Value payload;
    Json::CharReaderBuilder b;
    std::string errs;
    const std::unique_ptr<Json::CharReader> reader(b.newCharReader());
    if (!reader->parse(payload_json.data(),
                       payload_json.data() + payload_json.size(), &payload,
                       &errs)) {
        return false;
    }
    if (!payload.isMember("exp") || !payload["exp"].isInt64()) return false;
    const int64_t exp = payload["exp"].asInt64();
    if (unixNow() > exp) return false;
    if (!payload.isMember("sub") || !payload["sub"].isString()) return false;
    if (!payload.isMember("role") || !payload["role"].isString()) return false;
    out.username = payload["sub"].asString();
    out.role = payload["role"].asString();
    return true;
}

bool AuthService::parseBearer(const drogon::HttpRequestPtr& req,
                              AuthClaims& out) const {
    if (!req) return false;
    const std::string auth = req->getHeader("authorization");
    static const char kBearer[] = "Bearer ";
    constexpr size_t kLen = sizeof(kBearer) - 1;
    if (auth.size() <= kLen) return false;
    if (auth.compare(0, kLen, kBearer) != 0) return false;
    const std::string token = auth.substr(kLen);
    return verifyJwt(token, out);
}

int AuthService::roleRank(const std::string& role) {
    if (role == "admin") return 3;
    if (role == "developer") return 2;
    if (role == "user") return 1;
    return 0;
}

bool AuthService::roleAtLeast(const std::string& actor_role,
                              const std::string& min_role) {
    return roleRank(actor_role) >= roleRank(min_role);
}

}  // namespace robot_monitor
