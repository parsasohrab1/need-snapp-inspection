from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    username: str
    password: str


class ReadyIn(BaseModel):
    remote_requested: bool = False
    window_note: str = ""


class InspectionRequestIn(BaseModel):
    remote_requested: bool = False
    note: str = ""
    in_payload: dict = Field(default_factory=dict)


class ApprovalNoteIn(BaseModel):
    note: str = ""
    unit_manager_id: int | None = None
    department: str = ""


class RequestReturnIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class ClientRejectIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class RequestCommentIn(BaseModel):
    body: str = Field(min_length=2, max_length=4000)


class AccountingStatusIn(BaseModel):
    status: str
    note: str = ""


class ClaimStatusIn(BaseModel):
    status: str
    note: str = ""


class ReportCommentIn(BaseModel):
    body: str


class ForceIn(BaseModel):
    inspector_id: int
    reason: str = Field(min_length=3)


class ArriveIn(BaseModel):
    lat: float
    lng: float


class LocationIn(BaseModel):
    lat: float
    lng: float


class AnswerIn(BaseModel):
    item_id: str
    value: str
    note: str = ""


class ChecklistIn(BaseModel):
    answers: list[AnswerIn]


class EvidenceIn(BaseModel):
    caption: str = ""
    kind: str = "item"
    lat: float | None = None
    lng: float | None = None


class SubmitIn(BaseModel):
    result: str
    note: str = ""


class ReviewIn(BaseModel):
    decision: str
    note: str = ""


class DocumentIn(BaseModel):
    equipment_id: int
    doc_type: str
    title: str
    filename: str


class FormIn(BaseModel):
    kind: str
    payload: dict = Field(default_factory=dict)
    sheet_id: int | None = None


class MomIn(BaseModel):
    title: str
    body: str = Field(min_length=10)
    held_on: str
    attendees: str = ""
