function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return replacements[character];
  });
}

export function renderEmail(
  subject: string,
  message: string,
): string {
  const safeSubject = escapeHtml(subject);

  const paragraphs = message
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph.trim())
    .map(
      (paragraph) => `
        <p style="
          margin:0 0 18px;
          font-size:16px;
          line-height:1.7;
          color:#334155;
          overflow-wrap:anywhere;
        ">
          ${escapeHtml(paragraph).replace(/\n/g, "<br>")}
        </p>
      `,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeSubject}</title>
</head>
<body style="
  margin:0;
  padding:0;
  background-color:#f3f5f0;
  font-family:Arial,Helvetica,sans-serif;
">
  <table
    role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="background-color:#f3f5f0;"
  >
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table
          role="presentation"
          width="600"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            width:100%;
            max-width:600px;
            background-color:#ffffff;
            border-radius:16px;
          "
        >
          <tr>
            <td style="
              padding:28px 28px 24px;
              background-color:#153f31;
              border-radius:16px 16px 0 0;
            ">
              <p style="
                margin:0;
                color:#ffffff;
                font-size:28px;
                font-weight:bold;
              ">
                loRan <span style="color:#ffad70;">Shopper</span>
              </p>
              <p style="
                margin:10px 0 0;
                color:#d7e5db;
                font-size:13px;
                letter-spacing:1px;
              ">
                LOCAL MARKETS. LESS HASSLE.
              </p>
            </td>
          </tr>

          <tr>
            <td style="
              padding:8px 28px 0;
              border-top:4px solid #e77b36;
            ">
              <h1 style="
                margin:24px 0 20px;
                color:#153f31;
                font-size:24px;
                line-height:1.35;
              ">
                ${safeSubject}
              </h1>

              ${paragraphs}

              <p style="
                margin:28px 0;
                color:#475569;
                font-size:15px;
                line-height:1.6;
              ">
                Thank you,<br>
                <strong>The loRan Shopper team</strong>
              </p>
            </td>
          </tr>

          <tr>
            <td style="
              padding:20px 28px;
              background-color:#f8faf6;
              border-top:1px solid #e4e9e0;
              border-radius:0 0 16px 16px;
            ">
              <p style="
                margin:0 0 8px;
                color:#153f31;
                font-size:14px;
                font-weight:bold;
              ">
                Shop smart. Live easy.
              </p>
              <p style="
                margin:0;
                color:#64748b;
                font-size:12px;
                line-height:1.6;
              ">
                Keep your verification codes and private order ID safe.
                Never share your password or verification codes.
              </p>
              <p style="
                margin:12px 0 0;
                color:#64748b;
                font-size:12px;
              ">
                &copy; ${new Date().getFullYear()} loRan Shopper
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}