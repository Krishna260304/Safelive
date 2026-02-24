OFFICIAL_ROLES = (
    "department",
    "supervisor",
    "field_inspector",
    "worker",
)

WORKER_SPECIALIZATIONS = (
    "Road Maintenance Worker",
    "Electrician",
    "Plumber",
    "Drainage Worker",
    "Sanitation Worker",
    "Water Supply Technician",
    "Technician",
    "Emergency Response Worker",
    "Security Officer",
    "Complaint Manager",
    "Operations Manager",
    "General Worker",
    "Other",
)


def normalize_official_role(value: str | None) -> str | None:
    normalized = (value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in OFFICIAL_ROLES:
        return normalized
    return None


def normalize_worker_specialization(value: str | None) -> str | None:
    text = (value or "").strip()
    if not text:
        return None
    for option in WORKER_SPECIALIZATIONS:
        if text.lower() == option.lower():
            return option
    return None
