import hashlib
import hmac
import os


def _secret() -> bytes:
    return os.environ.get("NSI_SECRET", "need-snapp-inspection-demo").encode()


def hash_password(password: str) -> str:
    salt = os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    salt, digest = stored.split("$", 1)
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return hmac.compare_digest(check, digest)


def make_token(user_id: int) -> str:
    body = str(user_id)
    sig = hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{body}.{sig}"


def read_token(token: str | None) -> int | None:
    if not token or "." not in token:
        return None
    body, sig = token.split(".", 1)
    expected = hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        return int(body)
    except ValueError:
        return None
