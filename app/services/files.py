import uuid
from pathlib import Path
from mimetypes import guess_type

from app.domain.errors import DomainError

EVIDENCE_DIR = Path("data/evidence")
DOCUMENT_DIR = Path("data/documents")
REQUEST_SIGNATURE_DIR = Path("data/request-signatures")
MAX_BYTES = 8_000_000
MAX_REQUEST_SIGNATURE_BYTES = 8_000_000
MAX_DOCUMENT_BYTES = 100_000_000
REQUEST_SIGNATURE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
DOCUMENT_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm",
    ".avi", ".txt", ".csv",
}


def sniff_image(raw: bytes) -> str:
    if len(raw) < 12 or len(raw) > MAX_BYTES:
        raise DomainError("bad_image", "عکس خالی است یا از ۸ مگابایت بزرگ‌تر است.", 400)
    if raw.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return ".webp"
    raise DomainError("bad_image", "فقط عکس JPEG، PNG یا WebP دوربین پذیرفته می‌شود.", 400)


def store_photo(raw: bytes) -> str:
    suffix = sniff_image(raw)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{suffix}"
    (EVIDENCE_DIR / name).write_bytes(raw)
    return name


def photo_path(stored_name: str) -> Path:
    if not stored_name or "/" in stored_name or "\\" in stored_name or stored_name != Path(stored_name).name:
        raise DomainError("not_found", "فایل عکس پیدا نشد.", 404)
    return EVIDENCE_DIR / stored_name


def store_document(raw: bytes, filename: str) -> str:
    suffix, _media_type = validate_attachment(raw, filename)
    return _store(raw, suffix, DOCUMENT_DIR)


def store_request_signature(raw: bytes, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in REQUEST_SIGNATURE_EXTENSIONS or len(raw) > MAX_REQUEST_SIGNATURE_BYTES:
        raise DomainError("bad_signature", "مهر و امضا باید تصویر JPEG، PNG یا WebP حداکثر ۸ مگابایتی باشد.", 400)
    validated_suffix, _media_type = validate_attachment(raw, filename)
    if validated_suffix != suffix:
        raise DomainError("bad_signature", "محتوای تصویر مهر و امضا معتبر نیست.", 400)
    return _store(raw, suffix, REQUEST_SIGNATURE_DIR)


def store_evidence_attachment(raw: bytes, filename: str) -> tuple[str, str]:
    suffix, media_type = validate_attachment(raw, filename)
    return _store(raw, suffix, EVIDENCE_DIR), media_type


def validate_attachment(raw: bytes, filename: str) -> tuple[str, str]:
    suffix = Path(filename).suffix.lower()
    if not raw or len(raw) > MAX_DOCUMENT_BYTES:
        raise DomainError("bad_document", "فایل خالی است یا از ۱۰۰ مگابایت بزرگ‌تر است.", 400)
    if suffix not in DOCUMENT_EXTENSIONS:
        raise DomainError("bad_document", "نوع فایل پشتیبانی نمی‌شود.", 400)
    valid = True
    if suffix in {".jpg", ".jpeg", ".png", ".webp"}:
        valid = sniff_image(raw) == suffix or suffix == ".jpeg" and raw.startswith(b"\xff\xd8\xff")
    elif suffix == ".pdf":
        valid = raw.startswith(b"%PDF-")
    elif suffix == ".doc":
        valid = raw.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
    elif suffix in {".docx", ".xlsx", ".pptx"}:
        valid = raw.startswith(b"PK\x03\x04")
    elif suffix in {".mp4", ".mov"}:
        valid = len(raw) >= 12 and raw[4:8] == b"ftyp"
    elif suffix == ".webm":
        valid = raw.startswith(b"\x1a\x45\xdf\xa3")
    elif suffix == ".avi":
        valid = len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"AVI "
    elif suffix in {".txt", ".csv"}:
        try:
            raw.decode("utf-8-sig")
            valid = b"\x00" not in raw
        except UnicodeDecodeError:
            valid = False
    elif suffix in {".xls", ".ppt"}:
        valid = raw.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
    if not valid:
        raise DomainError("bad_document", "محتوای فایل با پسوند انتخاب‌شده مطابقت ندارد.", 400)
    return suffix, guess_type(filename)[0] or "application/octet-stream"


def _store(raw: bytes, suffix: str, folder: Path) -> str:
    folder.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    (folder / stored_name).write_bytes(raw)
    return stored_name


def document_path(stored_name: str) -> Path:
    if not stored_name or "/" in stored_name or "\\" in stored_name or stored_name != Path(stored_name).name:
        raise DomainError("not_found", "سند پیدا نشد.", 404)
    return DOCUMENT_DIR / stored_name


def request_signature_path(stored_name: str) -> Path:
    if not stored_name or "/" in stored_name or "\\" in stored_name or stored_name != Path(stored_name).name:
        raise DomainError("not_found", "تصویر مهر و امضا پیدا نشد.", 404)
    return REQUEST_SIGNATURE_DIR / stored_name


def document_media_type(filename: str) -> str:
    return guess_type(filename)[0] or "application/octet-stream"
