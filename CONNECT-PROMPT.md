# החיבור הכי פשוט — תן ל-Claude Code לחבר את עצמו

> הדרך המומלצת (עובדת ב-Windows וב-Mac, בלי פקודות ידניות/מרכאות).
> **צעד מקדים:** היכנס ל-`app.autotuesday.com/me/desktop` → "🎲 צור לי סיסמה" → "הגדר סיסמת מחשב".
> שמור את המייל והסיסמה — Claude יבקש אותם.

פתח Claude Code (בכל תיקייה) והדבק את הפרומפט הבא **כמו שהוא**:

---

```
חבר את ה-Claude Code הזה למאגר הידע של אוטוטיוזדיי (MCP בשם autotuesday-kb).
בצע את כל ההתקנה בעצמך, שלב-שלב, והתאם למערכת ההפעלה שלי:

1. שכפל והכן את הריפו:
   git clone https://github.com/netanelhibsh/autotuesday-kb-mcp.git
   ואז בתוך התיקייה: npm install && npm run build
   (אם התיקייה כבר קיימת - השתמש בה.)

2. מצא את הנתיב המוחלט המלא לקובץ dist/index.js שנוצר.

3. שאל אותי מה המייל שלי בפורטל, ומה סיסמת-המחשב שהגדרתי ב-app.autotuesday.com/me/desktop.
   (אם עוד לא הגדרתי - הזכר לי להיכנס לשם, "צור לי סיסמה" ואז "הגדר סיסמת מחשב".)

4. הוסף לקובץ ההגדרות של Claude Code (settings.json) שרת MCP חדש בשם autotuesday-kb
   בתוך mcpServers, בלי למחוק שרתים קיימים, וגבה את הקובץ קודם. עם:
     command: node
     args: [ הנתיב המלא ל-dist/index.js משלב 2 ]
     env:
       AT_KB_SUPABASE_URL = https://vgvaqputxdmaavawsown.supabase.co
       AT_KB_SUPABASE_ANON_KEY = sb_publishable__bWyTWREnxyirDXJf8faFA_Tyzxz9ER
       AT_KB_EMAIL = (המייל שלי)
       AT_KB_PASSWORD = (סיסמת-המחשב שלי)
   ודא שה-JSON תקין.

5. אמור לי לסגור ולפתוח מחדש את Claude Code, ואז לשאול "whoami של autotuesday-kb" לבדיקה.
```

---

זהו. Claude יבקש אישורים תוך כדי (git/npm/עריכת קובץ) — פשוט אשר.
לבדיקה אחרי restart: *"whoami של autotuesday-kb"* → חוזר השם והתפקיד שלך = מחובר ✅.
ואז: *"מה השתנה בזאבים?"* / *"מה ההחלטות האחרונות של אוטוטיוזדיי?"*

המדריך המלא: `ONBOARDING.md` · בניית סקילים משלך: `BUILD-YOUR-OWN-SKILLS.md`.
