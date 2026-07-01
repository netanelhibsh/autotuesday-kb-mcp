# autotuesday-kb-mcp

שרת MCP שכל שותף מריץ **במחשב שלו**. הוא רק **צינור**: מתחבר פעם אחת עם הזהות של
השותף, ונושא את הזהות הזו (JWT) ל-Supabase בכל קריאה. **ההחלטה מי רואה מה נעשית
ב-Supabase (RLS), לא כאן.** באג בקובץ הזה לא יכול לדלוף דאטה פרטי של מישהו אחר —
מסד הנתונים עצמו מסנן.

חלק ממסלול 08 (מערכת ניהול ידע ארגונית). אפיון: `chief-of-staff/.../tracks/08-knowledge-system/SPEC.md`.

## התקנה
```bash
cd autotuesday-kb-mcp
npm install
npm run build
```

## חיבור (per partner)
השרת מתחבר כשותף כדי שה-RLS ידע מי הוא, ושומר session מקומי
(`~/.autotuesday-kb-session.json`, chmod 600) שמתחדש אוטומטית — מתחברים פעם אחת.

**א. מייל + סיסמה** (✅ מומלץ — session עצמאי, לא מתנגש עם הדפדפן):
```
AT_KB_SUPABASE_URL=https://vgvaqputxdmaavawsown.supabase.co
AT_KB_SUPABASE_ANON_KEY=sb_publishable__bWyTWREnxyirDXJf8faFA_Tyzxz9ER
AT_KB_EMAIL=<המייל שלך בפורטל>
AT_KB_PASSWORD=<הסיסמה שלך>
```

**ב. Refresh token** (bootstrap חד-פעמי / בדיקה בלבד):
```
AT_KB_SUPABASE_URL=...
AT_KB_SUPABASE_ANON_KEY=...
AT_KB_REFRESH_TOKEN=<token מדף "חבר את המחשב" בפורטל>
```
> ⚠️ ה-refresh token של הדפדפן מתחלף בכל שימוש (rotation) → מתאים רק ל-bootstrap/בדיקה,
> לא לטווח ארוך. לעבודה שוטפת — מייל+סיסמה (א), שיוצר session עצמאי. דף ה-onboarding:
> `app.autotuesday.com/me/desktop`.

## רישום ב-Claude Code (`~/.claude/settings.json`)
```json
{
  "mcpServers": {
    "autotuesday-kb": {
      "command": "node",
      "args": ["/absolute/path/to/autotuesday-kb-mcp/dist/index.js"],
      "env": {
        "AT_KB_SUPABASE_URL": "https://vgvaqputxdmaavawsown.supabase.co",
        "AT_KB_SUPABASE_ANON_KEY": "sb_publishable__bWyTWREnxyirDXJf8faFA_Tyzxz9ER",
        "AT_KB_EMAIL": "you@example.com",
        "AT_KB_PASSWORD": "..."
      }
    }
  }
}
```

## Tools
| tool | מה עושה |
|------|---------|
| `whoami` | מי אני (person + role) — בדיקת זהות |
| `kb_search` | חיפוש טקסט ב-KB (רק מה שמותר לי לראות) |
| `kb_list` | רשימת פריטים (סינון לפי workspace/kind/visibility) |
| `kb_read` | קריאת פריט בודד (גוף מלא) |
| `kb_write` | יצירה (בלי id) / עדכון (עם id). visibility: org/workspace/private |
| `kb_history` | רשימת גרסאות של פריט |
| `kb_rollback` | החזרה לגרסה קודמת (עצמה מגורסאת — אפס איבוד) |
| `workspaces_list` | הפרויקטים שיש לי גישה אליהם |

## עקרון אבטחה
כל הכלים רצים דרך client מאומת כשותף. **RLS ב-Supabase** אוכף org/workspace/private
פר-שורה. השרת לא מחליט הרשאות — רק מעביר את הזהות. זה מה ש-production-build-standard
דורש: אבטחה בשכבת הדאטה, לא בקוד.
