from __future__ import annotations

import logging
import re
import smtplib
import socket
import ssl
import time
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from html import escape

from app.config.settings import settings

LOGGER = logging.getLogger(__name__)
EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class EmailConfigurationError(RuntimeError):
    pass


class EmailDeliveryError(RuntimeError):
    pass


@dataclass(frozen=True)
class EmailDeliveryResult:
    ok: bool
    to_email: str
    subject: str
    attempts: int
    error: str | None = None


def _validate_recipient(to_email: str) -> str:
    recipient = (to_email or "").strip()
    if not recipient:
        raise EmailDeliveryError("Recipient email is required")
    if not EMAIL_REGEX.match(recipient):
        raise EmailDeliveryError(f"Invalid recipient email: {recipient}")
    return recipient


def _from_header_value() -> str:
    sender_name = settings.EMAIL_FROM_NAME.strip()
    sender_address = settings.EMAIL_FROM.strip()
    if sender_name:
        return formataddr((sender_name, sender_address))
    return sender_address


def _assert_email_configuration() -> None:
    if not settings.EMAIL_ENABLED:
        raise EmailConfigurationError("Email service is disabled (EMAIL_ENABLED=false)")
    if not settings.EMAIL_USER:
        raise EmailConfigurationError("EMAIL_USER is missing")
    if not settings.EMAIL_PASS:
        raise EmailConfigurationError("EMAIL_PASS is missing")
    if not settings.EMAIL_FROM:
        raise EmailConfigurationError("EMAIL_FROM is missing")
    if settings.SMTP_PORT <= 0:
        raise EmailConfigurationError("SMTP_PORT must be a positive integer")
    if settings.EMAIL_MAX_RETRIES <= 0:
        raise EmailConfigurationError("EMAIL_MAX_RETRIES must be a positive integer")


def _build_message(subject: str, to_email: str, text_body: str, html_body: str | None) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = _from_header_value()
    msg["To"] = to_email
    if settings.EMAIL_REPLY_TO:
        msg["Reply-To"] = settings.EMAIL_REPLY_TO.strip()
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    return msg


def _send_once(msg: EmailMessage) -> None:
    timeout = max(5, settings.SMTP_TIMEOUT_SECONDS)
    if settings.SMTP_USE_SSL:
        with smtplib.SMTP_SSL(
            host=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            timeout=timeout,
            context=ssl.create_default_context(),
        ) as server:
            server.login(settings.EMAIL_USER, settings.EMAIL_PASS)
            server.send_message(msg)
        return

    with smtplib.SMTP(host=settings.SMTP_HOST, port=settings.SMTP_PORT, timeout=timeout) as server:
        server.ehlo()
        if settings.SMTP_USE_TLS:
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
        server.login(settings.EMAIL_USER, settings.EMAIL_PASS)
        server.send_message(msg)


def send_email(subject: str, to_email: str, text_body: str, html_body: str | None = None) -> EmailDeliveryResult:
    _assert_email_configuration()
    recipient = _validate_recipient(to_email)
    message = _build_message(subject=subject.strip(), to_email=recipient, text_body=text_body, html_body=html_body)

    last_error: str | None = None
    max_attempts = settings.EMAIL_MAX_RETRIES
    for attempt in range(1, max_attempts + 1):
        try:
            _send_once(message)
            LOGGER.info(
                "Email sent",
                extra={"to": recipient, "subject": subject, "attempt": attempt, "transport": "smtp"},
            )
            return EmailDeliveryResult(ok=True, to_email=recipient, subject=subject, attempts=attempt)
        except smtplib.SMTPAuthenticationError as exc:
            last_error = f"SMTP authentication failed: {exc}"
            LOGGER.error(
                "Email authentication failed for SMTP user %s. Use a valid app password.",
                settings.EMAIL_USER,
            )
            break
        except (smtplib.SMTPException, OSError, socket.timeout) as exc:
            last_error = str(exc)
            LOGGER.warning(
                "Email send attempt %s/%s failed for %s: %s",
                attempt,
                max_attempts,
                recipient,
                last_error,
            )
            if attempt < max_attempts:
                delay_seconds = settings.EMAIL_RETRY_BACKOFF_SECONDS * attempt
                time.sleep(max(0.1, delay_seconds))

    error_message = (
        f"Unable to deliver email to {recipient} after {max_attempts} attempt(s): {last_error or 'unknown error'}"
    )
    raise EmailDeliveryError(error_message)


def _render_email_frame(
    title: str,
    intro: str,
    details: list[tuple[str, str]],
    extra_html: str | None = None,
) -> str:
    row_html = []
    for label, value in details:
        value_text = value or "N/A"
        safe_label = escape(label)
        safe_value = escape(value_text)
        if value_text.startswith(("http://", "https://")):
            safe_value = (
                f"<a href='{safe_value}' style='color:#0f62fe;text-decoration:none' target='_blank'>{safe_value}</a>"
            )
        row_html.append(
            f"<tr><td style='padding:6px 10px;font-weight:600'>{safe_label}</td>"
            f"<td style='padding:6px 10px'>{safe_value}</td></tr>"
        )
    rows = "".join(row_html)
    return (
        "<!doctype html>"
        "<html><body style='margin:0;background:#f5f7fb;font-family:Arial,sans-serif'>"
        "<table width='100%' cellpadding='0' cellspacing='0' style='padding:24px 0'>"
        "<tr><td align='center'>"
        "<table width='620' cellpadding='0' cellspacing='0' "
        "style='max-width:620px;background:#ffffff;border-radius:8px;border:1px solid #e7ecf4'>"
        "<tr><td style='padding:20px 24px;border-bottom:1px solid #edf1f7'>"
        f"<h2 style='margin:0;font-size:20px;color:#1b2733'>{escape(title)}</h2></td></tr>"
        "<tr><td style='padding:18px 24px;color:#243241;font-size:14px;line-height:1.6'>"
        f"<p style='margin:0 0 14px 0'>{escape(intro)}</p>"
        "<table width='100%' cellpadding='0' cellspacing='0' "
        "style='border:1px solid #edf1f7;border-radius:6px'>"
        f"{rows}</table>"
        f"{extra_html or ''}</td></tr>"
        "<tr><td style='padding:14px 24px;background:#f8faff;color:#6d7a89;font-size:12px'>"
        "SafeLive notification service</td></tr>"
        "</table></td></tr></table></body></html>"
    )


def send_alert_email(description: str, lat: float | None, lon: float | None) -> EmailDeliveryResult:
    subject = "SafeLive Alert"
    intro = "A new issue was detected and requires attention."
    details = [
        ("Description", description or "N/A"),
        ("Latitude", "N/A" if lat is None else str(lat)),
        ("Longitude", "N/A" if lon is None else str(lon)),
    ]
    text_body = (
        "Issue Detected\n\n"
        f"Description: {details[0][1]}\n"
        f"Latitude: {details[1][1]}\n"
        f"Longitude: {details[2][1]}\n\n"
        "Login to dashboard for details."
    )
    html_body = _render_email_frame(title=subject, intro=intro, details=details)
    return send_email(subject=subject, to_email=settings.EMAIL_ALERT_TO, text_body=text_body, html_body=html_body)


def send_password_reset_email(to_email: str, reset_link: str) -> EmailDeliveryResult:
    subject = "SafeLive Password Reset"
    intro = "A password reset request was received for your account."
    details = [
        ("Reset link", reset_link),
        ("Expires in", f"{settings.PASSWORD_RESET_EXPIRE_MINUTES} minutes"),
    ]
    text_body = (
        "You requested a password reset.\n\n"
        f"Use this link to reset your password:\n{reset_link}\n\n"
        "If you did not request this, you can ignore this email."
    )
    html_body = _render_email_frame(title=subject, intro=intro, details=details)
    return send_email(subject=subject, to_email=to_email, text_body=text_body, html_body=html_body)


def send_otp_email(to_email: str, otp: str, context: str, expires_minutes: int) -> EmailDeliveryResult:
    subject = "SafeLive Verification Code"
    intro = f"Use this one-time code to complete {context}."
    details = [
        ("One-time code", otp),
        ("Expires in", f"{expires_minutes} minutes"),
    ]
    text_body = (
        f"Your SafeLive verification code is: {otp}\n\n"
        f"Expires in: {expires_minutes} minutes\n\n"
        "If you did not request this, you can ignore this email."
    )
    html_body = _render_email_frame(title=subject, intro=intro, details=details)
    return send_email(subject=subject, to_email=to_email, text_body=text_body, html_body=html_body)


def send_registration_email(to_email: str, name: str, user_type: str) -> EmailDeliveryResult:
    subject = "Welcome to SafeLive"
    display_name = (name or "User").strip()
    role = (user_type or "citizen").strip()
    intro = f"Hi {display_name}, your SafeLive account has been created successfully."
    details = [("Name", display_name), ("Role", role), ("Dashboard", settings.DOMAIN)]
    text_body = (
        f"Hi {display_name},\n\n"
        "Your SafeLive account is now active.\n"
        f"Role: {role}\n"
        f"Dashboard: {settings.DOMAIN}\n\n"
        "If you did not create this account, contact support immediately."
    )
    html_body = _render_email_frame(title=subject, intro=intro, details=details)
    return send_email(subject=subject, to_email=to_email, text_body=text_body, html_body=html_body)


def send_incident_submission_email(
    to_email: str,
    incident_id: str,
    title: str,
    category: str,
    priority: str | None,
    status: str,
    location: str,
    created_at: str,
) -> EmailDeliveryResult:
    subject = "SafeLive Incident Submitted"
    intro = "Your incident report was submitted successfully."
    details = [
        ("Incident ID", incident_id or "N/A"),
        ("Title", title or "N/A"),
        ("Category", category or "N/A"),
        ("Priority", (priority or "N/A").upper() if priority else "N/A"),
        ("Status", (status or "open").replace("_", " ")),
        ("Location", location or "N/A"),
        ("Submitted At", created_at or "N/A"),
    ]
    text_body = (
        "Your incident report has been submitted successfully.\n\n"
        f"Incident ID: {details[0][1]}\n"
        f"Title: {details[1][1]}\n"
        f"Category: {details[2][1]}\n"
        f"Priority: {details[3][1]}\n"
        f"Status: {details[4][1]}\n"
        f"Location: {details[5][1]}\n"
        f"Submitted At: {details[6][1]}\n\n"
        "Keep this Incident ID for future tracking."
    )
    html_body = _render_email_frame(title=subject, intro=intro, details=details)
    return send_email(subject=subject, to_email=to_email, text_body=text_body, html_body=html_body)


def send_ticket_update_email(to_email: str, title: str, status: str) -> EmailDeliveryResult:
    subject = "SafeLive Ticket Update"
    intro = "Your ticket status has changed."
    details = [("Title", title or "Ticket"), ("Status", status or "updated")]
    text_body = (
        "Your ticket has been updated.\n\n"
        f"Title: {details[0][1]}\n"
        f"Status: {details[1][1]}\n\n"
        "Login to dashboard for details."
    )
    html_body = _render_email_frame(title=subject, intro=intro, details=details)
    return send_email(subject=subject, to_email=to_email, text_body=text_body, html_body=html_body)


def send_field_inspector_reminder_email(
    to_email: str,
    inspector_name: str,
    ticket_id: str,
    ticket_title: str,
    due_date: str,
) -> EmailDeliveryResult:
    subject = "SafeLive Reminder: Daily Field Update Pending"
    intro = (
        f"Hi {inspector_name}, daily ticket progress update is pending. "
        "Please submit your field update before 6:00 PM IST."
    )
    details = [
        ("Ticket ID", ticket_id or "N/A"),
        ("Ticket", ticket_title or "N/A"),
        ("Due date (IST)", due_date or "Today"),
        ("Action", "Submit inspector update in SafeLive dashboard"),
    ]
    text_body = (
        f"Hi {inspector_name},\n\n"
        "Your daily field progress update is pending.\n"
        f"Ticket ID: {details[0][1]}\n"
        f"Ticket: {details[1][1]}\n"
        f"Due date (IST): {details[2][1]}\n\n"
        "Please submit the update before 6:00 PM IST."
    )
    html_body = _render_email_frame(title=subject, intro=intro, details=details)
    return send_email(subject=subject, to_email=to_email, text_body=text_body, html_body=html_body)


def send_critical_incident_review_email(
    *,
    to_email: str,
    reviewer_name: str,
    incident_id: str,
    title: str,
    category: str,
    location: str,
    priority: str,
    created_at: str,
    approve_url: str,
    reject_url: str,
    extra_details: list[tuple[str, str]] | None = None,
    image_urls: list[str] | None = None,
) -> EmailDeliveryResult:
    subject = "SafeLive Critical Incident Review Required"
    reviewer = (reviewer_name or "Reviewer").strip()
    intro = (
        f"Hi {reviewer}, a critical incident was flagged by AI and requires your email decision. "
        "Use one of the actions below."
    )
    details = [
        ("Incident ID", incident_id or "N/A"),
        ("Title", title or "N/A"),
        ("Category", category or "N/A"),
        ("Priority", (priority or "critical").upper()),
        ("Location", location or "N/A"),
        ("Reported At", created_at or "N/A"),
    ]
    for label, value in (extra_details or []):
        if not str(label or "").strip():
            continue
        details.append((str(label), str(value or "N/A")))

    for idx, url in enumerate(image_urls or []):
        safe_url = str(url or "").strip()
        if not safe_url:
            continue
        details.append((f"Image {idx + 1}", safe_url))

    safe_approve = escape(approve_url)
    safe_reject = escape(reject_url)
    actions_html = (
        "<div style='margin-top:16px'>"
        f"<a href='{safe_approve}' "
        "style='display:inline-block;margin-right:10px;padding:10px 14px;border-radius:6px;"
        "background:#1f7a1f;color:#ffffff;text-decoration:none;font-weight:600'>Approve</a>"
        f"<a href='{safe_reject}' "
        "style='display:inline-block;padding:10px 14px;border-radius:6px;"
        "background:#b42318;color:#ffffff;text-decoration:none;font-weight:600'>Reject</a>"
        "</div>"
        "<p style='margin:10px 0 0 0;color:#5b6775;font-size:12px'>"
        "This action link is secure and tied to this incident review request."
        "</p>"
    )

    detail_lines = "\n".join(f"{label}: {value}" for label, value in details)
    text_body = (
        f"Hi {reviewer},\n\n"
        "A critical incident requires your decision.\n\n"
        f"{detail_lines}\n\n"
        f"Approve: {approve_url}\n"
        f"Reject: {reject_url}\n"
    )
    html_body = _render_email_frame(title=subject, intro=intro, details=details, extra_html=actions_html)
    return send_email(subject=subject, to_email=to_email, text_body=text_body, html_body=html_body)
