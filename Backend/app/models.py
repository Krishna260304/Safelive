from pydantic import BaseModel

class RegisterModel(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    password: str
    userType: str
    address: str | None = None
    pincode: str | None = None
    officialRole: str | None = None
    workerSpecialization: str | None = None

class LoginModel(BaseModel):
    email: str | None = None
    phone: str | None = None
    password: str
    expectedUserType: str | None = None
    expectedOfficialRole: str | None = None

class IncidentCreate(BaseModel):
    title: str
    description: str
    category: str
    priority: str | None = None
    location: str
    latitude: float | None = None
    longitude: float | None = None
    images: list[str] | None = None
    severity: str | None = None
    scope: str | None = None
    source: str | None = None
    deviceId: str | None = None
    votes: int | None = None

class IncidentUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    status: str | None = None
    priority: str | None = None
    location: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    images: list[str] | None = None
    assignedTo: str | None = None
    severity: str | None = None
    scope: str | None = None

class TicketUpdateStatus(BaseModel):
    status: str
    notes: str | None = None

class TicketAssign(BaseModel):
    workerId: str | None = None
    workerIds: list[str] | None = None
    assignedTo: str | None = None
    assigneeName: str | None = None
    assigneePhone: str | None = None
    assigneePhoto: str | None = None
    notes: str | None = None

class TicketAssignSupervisor(BaseModel):
    supervisorId: str
    notes: str | None = None

class TicketProgressUpdate(BaseModel):
    updateText: str
    editLastUpdate: bool | None = None

class MessageCreate(BaseModel):
    message: str

class UserUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    pincode: str | None = None
    department: str | None = None

class DepartmentOfficialCreate(BaseModel):
    name: str
    email: str
    phone: str | None = None
    password: str
    officialRole: str
    address: str | None = None
    pincode: str | None = None

class ForgotPasswordRequest(BaseModel):
    email: str | None = None
    phone: str | None = None

class ResetPasswordRequest(BaseModel):
    token: str
    password: str

class OtpVerifyRequest(BaseModel):
    challengeId: str
    otp: str

class PasswordChangeRequestOtp(BaseModel):
    currentPassword: str

class PasswordChangeConfirm(BaseModel):
    challengeId: str
    otp: str
    newPassword: str
