# backend/app/services/email_template.py
"""
Builds the final HTML for the weekly summary email.

Takes Claude's structured output + a few user fields and wraps it in a
simple, mobile-friendly HTML shell with a footer link to unsubscribe.
"""
from __future__ import annotations


def render_weekly_summary_html(
    *,
    user_name: str | None,
    preheader: str,
    summary_html: str,
    suggestions: list[str],
    unsubscribe_url: str,
    week_ending: str,
) -> str:
    greeting = f"Hi {user_name}," if user_name else "Hi,"
    suggestions_html = "".join(f"<li>{s}</li>" for s in suggestions)

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JobTrackr — Weekly Summary</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222;">
  <!-- preheader: hidden in body, shown in inbox preview -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f6f7f9;">
    {preheader}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f7f9;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:600px;">
          <tr>
            <td style="padding:24px 28px 8px;">
              <div style="font-size:13px;color:#888;letter-spacing:.5px;text-transform:uppercase;">JobTrackr — Week ending {week_ending}</div>
              <h1 style="margin:8px 0 16px;font-size:22px;line-height:1.3;color:#111;">Your weekly summary</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">{greeting}</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 28px;font-size:15px;line-height:1.6;color:#222;">
              {summary_html}
            </td>
          </tr>

          <tr>
            <td style="padding:8px 28px 24px;">
              <h2 style="margin:24px 0 8px;font-size:16px;color:#111;">Suggested next steps</h2>
              <ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.6;">
                {suggestions_html}
              </ul>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 28px 28px;border-top:1px solid #eee;">
              <p style="margin:0;font-size:12px;color:#888;line-height:1.5;">
                You're getting this because you turned on weekly summaries in JobTrackr.
                <a href="{unsubscribe_url}" style="color:#888;text-decoration:underline;">Unsubscribe</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""