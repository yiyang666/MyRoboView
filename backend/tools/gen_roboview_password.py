#!/usr/bin/env python3
"""生成 RoboView auth_users.json 所需的 PBKDF2-SHA256 密码哈希行。"""
import getpass
import hashlib
import secrets
import sys

ITERATIONS = 100000


def main() -> None:
    pw = getpass.getpass("输入新密码（不回显）: ")
    if not pw:
        print("密码为空，退出", file=sys.stderr)
        sys.exit(1)
    pw2 = getpass.getpass("再次输入确认: ")
    if pw != pw2:
        print("两次输入不一致", file=sys.stderr)
        sys.exit(1)
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256", pw.encode("utf-8"), salt, ITERATIONS
    )
    line = f"pbkdf2-sha256${ITERATIONS}${salt.hex()}${dk.hex()}"
    print("将下列整行粘贴到 auth_users.json 对应用户的 password_pbkdf2 字段：")
    print(line)


if __name__ == "__main__":
    main()
